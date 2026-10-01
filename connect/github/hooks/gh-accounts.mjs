import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Mirror the agent's Connect GitHub roster into the GitHub CLI (`gh`) so shell
 * `git` and `gh` work for private repositories. See ../DEVELOPING.md for the
 * ownership rules this module enforces.
 */

export const HOST = 'github.com';
/** Multi-account (`gh auth switch`, `--user` on token/logout) landed in gh 2.40.0. */
export const MIN_GH_VERSION = [2, 40, 0];
/** Exactly the keys `gh auth setup-git --hostname github.com` writes. */
export const HELPER_KEYS = ['credential.https://github.com.helper', 'credential.https://gist.github.com.helper'];
const MAX_ACCOUNTS = 64;
// Interrupted runs may retain earlier rosters; bound reads AND write-ahead unions.
const MAX_OWNED_ACCOUNTS = 256;
// Hook budget is 30 s (HOOK_TIMEOUT_MS in @alfe/integrations). Stay well inside it:
// local-only gh/git calls are short, network calls (`gh auth login`) longer, and
// no new step starts once the overall deadline is near.
export const LOCAL_TIMEOUT_MS = 5_000;
export const NETWORK_TIMEOUT_MS = 10_000;
export const HOOK_BUDGET_MS = 25_000;
// GitHub logins: alphanumerics and hyphens, at most 39 characters. Legacy
// accounts may contain doubled or trailing hyphens, so do not tighten further.
// GitHub App bot identities are `<slug>[bot]` (gh logs an Actions token in as
// `github-actions[bot]`); brackets are safe because gh is never run via a shell.
export const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\[bot\])?$/u;
const TOKEN = /^[\x21-\x7e]{1,1024}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const GH_HELPER = /^!.+ auth git-credential$/u;
const TOKEN_SHAPES = /\b(?:gh[oprsu]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/gu;
// Variables that make gh ignore (or refuse to write) its stored credentials.
const SCRUBBED_ENV = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST'];

const digest = (text) => createHash('sha256').update(text).digest('hex');
const matchesDigest = (entry, hash) => entry.sha256 === hash || entry.previousSha256 === hash;
// GitHub logins are case-insensitive; gh keys accounts by the API's spelling.
const lower = (login) => login.toLowerCase();

/** Error whose message was constructed without secrets and is safe to print. */
export class GithubCliError extends Error {}
/** The authoritative roster is unusable: the only failure that fails activation. */
export class RosterError extends GithubCliError {}
/** The hook budget is nearly spent; remaining work waits for the next activation. */
export class DeadlineError extends GithubCliError {}

/** Remove known token values and anything token-shaped, then bound the length. */
export function redact(text, secrets = []) {
  let value = String(text ?? '');
  for (const secret of secrets) if (secret) value = value.split(secret).join('[REDACTED]');
  return value.replace(TOKEN_SHAPES, '[REDACTED]').replace(/\s+/gu, ' ').trim().slice(0, 300);
}

/** Environment for gh/git children: no ambient token overrides, never prompt. */
export function childEnv(env = process.env) {
  const next = { ...env };
  for (const key of SCRUBBED_ENV) delete next[key];
  return { ...next, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' };
}

/**
 * Default executor: no shell, bounded time and output. Secrets only ever travel
 * on stdin (`input`); argv and env never carry a token.
 */
export function defaultExec(file, args, { input, timeout = LOCAL_TIMEOUT_MS } = {}) {
  const result = spawnSync(file, args, {
    input: input ?? '',
    encoding: 'utf8',
    timeout,
    maxBuffer: 1024 * 1024,
    env: childEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.error?.code === 'ENOENT') return { status: null, stdout: '', stderr: '', missing: true };
  if (result.error) return { status: null, stdout: '', stderr: result.error.code ?? 'spawn failed' };
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function run(exec, file, args, { input, secrets = [], allow = () => false, timeout = LOCAL_TIMEOUT_MS } = {}) {
  const result = exec(file, args, input === undefined ? { timeout } : { input, timeout });
  if (result.status === 0 || allow(result)) return result;
  const detail = result.missing ? 'not installed' : redact(result.stderr || result.stdout, secrets) || `exit ${String(result.status)}`;
  throw new GithubCliError(`${file} ${args.slice(0, 2).join(' ')} failed: ${detail}`);
}

/** Validate the complete authoritative roster before any gh call or ledger write. */
export function accountSnapshot(response) {
  if (!response || !Array.isArray(response.accounts) || response.accounts.length > MAX_ACCOUNTS) {
    throw new RosterError('GitHub accounts response must contain a complete bounded accounts array');
  }
  const seen = new Set();
  return response.accounts.map((account) => {
    const login = account?.login;
    if (typeof login !== 'string' || !LOGIN.test(login)) throw new RosterError('Invalid GitHub account login');
    if (seen.has(login.toLowerCase())) throw new RosterError('Duplicate GitHub account login');
    seen.add(login.toLowerCase());
    const token = account.accessToken;
    if (typeof token !== 'string' || !TOKEN.test(token)) throw new RosterError(`Invalid GitHub access token for ${login}`);
    return { login, token, sha256: digest(token) };
  });
}

/** `{ available, supported, version }` for the gh on PATH. */
export function ghStatus(exec = defaultExec) {
  const result = exec('gh', ['--version'], { timeout: LOCAL_TIMEOUT_MS });
  if (result.missing) return { available: false, supported: false, version: null };
  // A present but failing/hanging gh is an error to retry, not "not installed".
  if (result.status !== 0) throw new GithubCliError(`gh --version failed: ${redact(result.stderr) || `exit ${String(result.status)}`}`);
  const match = /gh version (\d+)\.(\d+)\.(\d+)/u.exec(result.stdout);
  if (!match) return { available: true, supported: false, version: null };
  const parts = match.slice(1, 4).map(Number);
  const cmp = parts.findIndex((part, i) => part !== MIN_GH_VERSION[i]);
  return { available: true, supported: cmp === -1 || parts[cmp] > MIN_GH_VERSION[cmp], version: parts.join('.') };
}

/** Digest of the token gh holds for `login`, or undefined when gh has no such account. */
function storedDigest(exec, login) {
  const result = run(exec, 'gh', ['auth', 'token', '--hostname', HOST, '--user', login], {
    allow: (r) => r.status === 1 && /no oauth token found/iu.test(r.stderr),
  });
  if (result.status !== 0) return undefined;
  const token = result.stdout.trim();
  return token ? digest(token) : undefined;
}

function activeLogin(exec) {
  const result = exec('gh', ['config', 'get', 'user', '--host', HOST], { timeout: LOCAL_TIMEOUT_MS });
  const login = result.status === 0 ? result.stdout.trim() : '';
  return LOGIN.test(login) ? login : undefined;
}

function gitHelperValues(exec) {
  const values = {};
  for (const key of HELPER_KEYS) {
    const result = exec('git', ['config', '--global', '--get-all', key], { timeout: LOCAL_TIMEOUT_MS });
    if (result.missing) return undefined;
    if (result.status === 1) values[key] = [];
    else if (result.status === 0) values[key] = result.stdout.replace(/\n$/u, '').split('\n');
    else throw new GithubCliError(`git config --get-all failed: ${redact(result.stderr) || `exit ${String(result.status)}`}`);
  }
  return values;
}

const sameValues = (a, b) => HELPER_KEYS.every((key) => JSON.stringify(a?.[key] ?? []) === JSON.stringify(b?.[key] ?? []));
export const looksLikeGhHelper = (values) => HELPER_KEYS.every((key) => {
  const list = values?.[key] ?? [];
  return list.length === 2 && list[0] === '' && GH_HELPER.test(list[1]);
});

function realDirectory(path) {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new GithubCliError('GitHub CLI state directory must be a real directory');
  return path;
}

function regularFile(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new GithubCliError('GitHub CLI ownership ledger must be a regular file');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function writeAtomic(path, text) {
  regularFile(path);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function parseHelper(raw) {
  if (raw === null || raw === undefined) return null;
  if (raw && raw.pending === true && Object.keys(raw).length === 1) return { pending: true };
  const values = raw?.values;
  if (!values || typeof values !== 'object' || Object.keys(values).length !== HELPER_KEYS.length
    || !HELPER_KEYS.every((key) => Array.isArray(values[key]) && values[key].length <= 4
      && values[key].every((v) => typeof v === 'string' && v.length <= 4096 && !/[\r\n]/u.test(v)))) {
    throw new GithubCliError('Invalid GitHub CLI git helper ownership entry');
  }
  return { values: Object.fromEntries(HELPER_KEYS.map((key) => [key, [...values[key]]])) };
}

function context(home) {
  const root = realpathSync(home);
  const state = realDirectory(join(realDirectory(join(root, '.alfe')), 'github-cli'));
  const path = join(state, 'owned-accounts.json');
  let accounts = [];
  let gitHelper = null;
  if (regularFile(path)) {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (raw?.version !== 1 || !Array.isArray(raw.accounts) || raw.accounts.length > MAX_OWNED_ACCOUNTS) {
      throw new GithubCliError('Invalid GitHub CLI ownership ledger');
    }
    const logins = new Set();
    accounts = raw.accounts.map((entry) => {
      if (!entry || typeof entry.login !== 'string' || !LOGIN.test(entry.login) || !SHA256.test(entry.sha256)
        || (entry.previousSha256 !== undefined && (typeof entry.previousSha256 !== 'string' || !SHA256.test(entry.previousSha256)))) {
        throw new GithubCliError('Invalid GitHub CLI ownership entry');
      }
      if (logins.has(lower(entry.login))) throw new GithubCliError('Duplicate GitHub CLI ownership entry');
      logins.add(lower(entry.login));
      return { login: entry.login, sha256: entry.sha256, ...(entry.previousSha256 === undefined ? {} : { previousSha256: entry.previousSha256 }) };
    });
    gitHelper = parseHelper(raw.gitHelper);
  }
  return { path, accounts, gitHelper };
}

function persist(ctx, accounts, gitHelper) {
  if (accounts.length > MAX_OWNED_ACCOUNTS) throw new GithubCliError('GitHub CLI ownership ledger capacity exceeded');
  writeAtomic(ctx.path, `${JSON.stringify({ version: 1, accounts, gitHelper }, null, 2)}\n`);
  ctx.accounts = accounts;
  ctx.gitHelper = gitHelper;
}

/**
 * Resolve recorded helper ownership against git's current values. A pending
 * (write-ahead) record is adopted only if the keys still hold gh's exact shape.
 */
function ownedHelper(ctx, current) {
  if (!ctx.gitHelper || !current) return null;
  if (ctx.gitHelper.pending) return looksLikeGhHelper(current) ? { values: current } : null;
  return sameValues(ctx.gitHelper.values, current) ? ctx.gitHelper : null;
}


/**
 * Logins gh holds for github.com, parsed from its local hosts.yml (no network).
 * gh >= 2.40 writes `github.com:` > `users:` > `<login>:` with block indentation;
 * an unrecognised layout throws rather than guessing.
 */
export function parseHostsLogins(text) {
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^(?:github\.com|"github\.com"|'github\.com'):\s*$/u.test(line));
  if (start === -1) return [];
  const indent = (line) => line.length - line.trimStart().length;
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (indent(line) === 0) break;
    block.push(line);
  }
  if (block.some((line) => /^\s+users:\s*\{\}\s*$/u.test(line))) return [];
  const usersAt = block.findIndex((line) => /^\s+users:\s*$/u.test(line));
  if (usersAt === -1) {
    // Pre-multi-account layout: one `user:` per host.
    const single = block.map((line) => /^\s+user:\s*(\S+)\s*$/u.exec(line)?.[1]?.replace(/^(["'])(.*)\1$/u, '$2')).find(Boolean);
    if (single && !LOGIN.test(single)) throw new GithubCliError('Unrecognised gh hosts.yml layout');
    return single ? [single] : [];
  }
  const base = indent(block[usersAt]);
  let child;
  const logins = [];
  for (const line of block.slice(usersAt + 1)) {
    const depth = indent(line);
    if (depth <= base) break;
    child ??= depth;
    if (depth > child) continue;
    // YAML quotes keys that would otherwise parse as non-strings (e.g. an
    // all-digit login is written as "12345":).
    const match = /^\s+(?:"([^"\\]+)"|'([^']+)'|([^\s:'"]+)):(?:\s*\{\})?\s*$/u.exec(line);
    const login = match && (match[1] ?? match[2] ?? match[3]);
    if (depth !== child || !login || !LOGIN.test(login)) throw new GithubCliError('Unrecognised gh hosts.yml layout');
    logins.push(login);
  }
  return logins;
}

/** gh's config dir: GH_CONFIG_DIR, else $XDG_CONFIG_HOME/gh, else ~/.config/gh. */
export function defaultListLogins({ home = homedir(), env = process.env } = {}) {
  const dir = env.GH_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(home, '.config'), 'gh');
  let text;
  try {
    text = readFileSync(join(dir, 'hosts.yml'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new GithubCliError('Unable to read gh hosts.yml');
  }
  return parseHostsLogins(text);
}

/** Bound every gh step by the overall hook deadline; resolve logins case-insensitively. */
function session({ exec, listLogins, home, now, budgetMs }) {
  const deadline = now() + budgetMs;
  const s = {
    has: (ms) => deadline - now() >= ms,
    ensure: (ms) => {
      if (!s.has(ms)) throw new DeadlineError('hook time budget nearly spent; remaining GitHub CLI work will continue on the next activation');
    },
    list: () => {
      s.ensure(LOCAL_TIMEOUT_MS);
      return listLogins({ home });
    },
    key: (login) => s.list().find((candidate) => lower(candidate) === lower(login)),
    digest: (login) => {
      const key = s.key(login);
      if (!key) return undefined;
      s.ensure(LOCAL_TIMEOUT_MS);
      return storedDigest(exec, key);
    },
    active: () => {
      s.ensure(LOCAL_TIMEOUT_MS);
      return activeLogin(exec);
    },
  };
  return s;
}

const safeMessage = (error) => (error instanceof GithubCliError ? error.message : 'unexpected error');

/**
 * Converge gh's github.com accounts on the authoritative roster.
 *
 * Throws RosterError only for an unusable roster (checked before any gh call).
 * Other gh-side problems either throw GithubCliError before any mutation, or
 * are returned as redacted `warnings` after recording the state actually
 * reached. Only logins this hook added (recorded with their token digest) are
 * ever re-authenticated or logged out; everything else is preserved.
 */
export function syncGithubAccounts({
  home, response, exec = defaultExec, platform = process.platform,
  listLogins = defaultListLogins, now = Date.now, budgetMs = HOOK_BUDGET_MS,
}) {
  const roster = accountSnapshot(response);
  const tokens = roster.map((account) => account.token);
  const s = session({ exec, listLogins, home, now, budgetMs });
  const gh = ghStatus(exec);
  if (!gh.supported) {
    return { skipped: gh.available ? `gh ${gh.version ?? 'unknown version'} lacks multi-account support (need >= ${MIN_GH_VERSION.join('.')})` : 'gh is not installed', warnings: [] };
  }
  const ctx = context(home);
  const owned = new Map(ctx.accounts.map((entry) => [lower(entry.login), entry]));
  const rosterKeys = new Set(roster.map((account) => lower(account.login)));
  const preexisting = new Set(s.list().map(lower));
  const previousActive = s.active();

  // Plan with local reads only. A failure here throws before any mutation.
  const logins = [];
  const keep = [];
  const logouts = [];
  let preserved = 0;
  let unchanged = 0;
  for (const account of roster) {
    const current = s.digest(account.login);
    const prior = owned.get(lower(account.login));
    if (current !== undefined && (!prior || !matchesDigest(prior, current))) {
      preserved += 1; // user-added, or replaced since we wrote it: never adopt
    } else if (current === account.sha256) {
      unchanged += 1;
      keep.push({ login: s.key(account.login), sha256: account.sha256 });
    } else {
      // Absent, or ours with an older token. Retain the prior digest (verified as
      // ours above) so an interrupted replacement stays recognisable next run.
      const login = (current && s.key(account.login)) || account.login;
      logins.push({ account, current, entry: { login, sha256: account.sha256, ...(current ? { previousSha256: current } : {}) } });
    }
  }
  for (const entry of ctx.accounts) {
    if (rosterKeys.has(lower(entry.login))) continue;
    const current = s.digest(entry.login);
    if (current === undefined) continue;
    if (matchesDigest(entry, current)) logouts.push({ ...entry, login: s.key(entry.login) });
    else preserved += 1;
  }

  // Write ahead of every gh mutation: prior ownership still on disk plus every
  // planned login. A crash leaves all of them recognisable and cleanable.
  const transition = new Map([...keep, ...logouts].map((entry) => [lower(entry.login), entry]));
  for (const { entry } of logins) transition.set(lower(entry.login), entry);
  persist(ctx, [...transition.values()], ctx.gitHelper);

  // `final` tracks what the hook verifiably owns as each step lands.
  const final = new Map([...keep, ...logouts].map((entry) => [lower(entry.login), entry]));
  for (const { current, entry } of logins) {
    if (current) final.set(lower(entry.login), { login: entry.login, sha256: current });
  }
  const warnings = [];
  let loggedIn = 0;
  let removed = 0;
  let stopped = false;
  const handle = (error) => {
    if (error instanceof DeadlineError) stopped = true;
    warnings.push(safeMessage(error));
  };

  const loginArgs = ['auth', 'login', '--hostname', HOST, '--git-protocol', 'https', '--with-token'];
  // Managed Linux VMs have no Secret Service; make storage deterministic there.
  if (platform === 'linux') loginArgs.push('--insecure-storage');
  for (const { account, entry } of logins) {
    if (stopped) break;
    try {
      // Never start a network call that could outlive the hook budget.
      s.ensure(NETWORK_TIMEOUT_MS + 2 * LOCAL_TIMEOUT_MS);
      let failure;
      try {
        run(exec, 'gh', loginArgs, { input: `${account.token}\n`, secrets: tokens, timeout: NETWORK_TIMEOUT_MS });
      } catch (error) {
        failure = error;
      }
      // Whatever gh reported, own the account only if gh now holds our token.
      if (s.digest(account.login) === entry.sha256) {
        final.set(lower(entry.login), { login: s.key(account.login), sha256: entry.sha256 });
        loggedIn += 1;
      } else if (!failure) {
        warnings.push(releaseRenamed({ s, exec, ctx, transition, final, preexisting, account, entry, tokens }));
      }
      if (failure) warnings.push(safeMessage(failure));
    } catch (error) {
      handle(error);
    }
  }
  for (const entry of logouts) {
    if (stopped) break;
    try {
      s.ensure(LOCAL_TIMEOUT_MS);
      run(exec, 'gh', ['auth', 'logout', '--hostname', HOST, '--user', entry.login], { secrets: tokens });
      final.delete(lower(entry.login));
      removed += 1;
    } catch (error) {
      handle(error);
    }
  }

  // Keep the user's or previously active account; otherwise Connect's priority
  // order (most specific scope, then most recently connected) picks the first.
  let target = null;
  if (!stopped) {
    try {
      for (const login of [previousActive, ...roster.map((account) => account.login)].filter(Boolean)) {
        if (s.digest(login) !== undefined) { target = s.key(login); break; }
      }
      const active = s.active();
      if (target && (!active || lower(active) !== lower(target))) {
        s.ensure(LOCAL_TIMEOUT_MS);
        run(exec, 'gh', ['auth', 'switch', '--hostname', HOST, '--user', target], { secrets: tokens });
      }
    } catch (error) {
      handle(error);
    }
  }

  const managed = [...final.values()];
  let gitHelper = { state: 'deferred', record: ctx.gitHelper };
  if (!stopped) {
    try {
      s.ensure(4 * LOCAL_TIMEOUT_MS);
      gitHelper = syncGitHelper(ctx, exec, managed, tokens);
    } catch (error) {
      gitHelper = { state: 'failed', record: ctx.gitHelper };
      handle(error);
    }
  }
  persist(ctx, managed, gitHelper.record);
  return {
    accounts: roster.length,
    loggedIn,
    unchanged,
    removed,
    preserved,
    active: target,
    gitHelper: gitHelper.state,
    warnings,
  };
}

/**
 * gh stores a token under the login the API reports. If that differs from the
 * roster (a renamed GitHub account), log out the account the hook just created
 * so no unowned credential survives, recording it first so a crash in between
 * still leaves it owned. A pre-existing (user) account is never touched.
 */
function releaseRenamed({ s, exec, ctx, transition, final, preexisting, account, entry, tokens }) {
  const advice = `gh stored the token for ${account.login} under a different login (renamed GitHub account?); reconnect it in Alfe`;
  for (const key of s.list()) {
    if (preexisting.has(lower(key)) || s.digest(key) !== entry.sha256) continue;
    // Owned in BOTH the write-ahead and the final ledger until the logout
    // succeeds: if it throws, the account stays owned and the next run or
    // uninstall removes it.
    const owned = { login: key, sha256: entry.sha256 };
    transition.set(lower(key), owned);
    final.set(lower(key), owned);
    persist(ctx, [...transition.values()], ctx.gitHelper);
    try {
      run(exec, 'gh', ['auth', 'logout', '--hostname', HOST, '--user', key], { secrets: tokens });
    } catch (error) {
      return `${advice}; could not remove the unexpected gh account ${key} (kept as owned for the next run or uninstall): ${safeMessage(error)}`;
    }
    transition.delete(lower(key));
    final.delete(lower(key));
    return `${advice}; removed the unexpected gh account ${key}`;
  }
  return advice;
}

function syncGitHelper(ctx, exec, managed, tokens) {
  const current = gitHelperValues(exec);
  if (!current) return { state: 'git-unavailable', record: ctx.gitHelper };
  const owned = ownedHelper(ctx, current);
  if (owned) return { state: 'owned', record: owned };
  if (HELPER_KEYS.some((key) => current[key].length > 0)) return { state: 'external', record: null };
  if (managed.length === 0) return { state: 'not-needed', record: null };
  persist(ctx, ctx.accounts, { pending: true });
  run(exec, 'gh', ['auth', 'setup-git', '--hostname', HOST], { secrets: tokens });
  const written = gitHelperValues(exec);
  if (!written || !looksLikeGhHelper(written)) throw new GithubCliError('gh auth setup-git did not write the expected credential helper');
  return { state: 'configured', record: { values: written } };
}

/**
 * Uninstall: remove only this hook's still-unmodified contributions. A missing,
 * old or broken gh, or a failing logout, keeps the affected ledger entries and
 * reports a warning instead of failing (a failing post_uninstall would wedge the
 * integration removal).
 */
export function removeGithubAccounts({ home, exec = defaultExec, listLogins = defaultListLogins }) {
  const ctx = context(home);
  const warnings = [];
  let removed = 0;
  let preserved = 0;
  let gh;
  try {
    gh = ghStatus(exec);
  } catch (error) {
    gh = { supported: false };
    warnings.push(safeMessage(error));
  }
  if (!gh.supported && ctx.accounts.length > 0) warnings.push('gh unavailable; recorded accounts retained for a later cleanup');
  const remaining = [];
  for (const entry of ctx.accounts) {
    if (!gh.supported) { remaining.push(entry); continue; }
    try {
      const key = listLogins({ home }).find((candidate) => lower(candidate) === lower(entry.login));
      const current = key ? storedDigest(exec, key) : undefined;
      if (current === undefined) continue;
      if (!matchesDigest(entry, current)) { preserved += 1; continue; }
      run(exec, 'gh', ['auth', 'logout', '--hostname', HOST, '--user', key]);
      removed += 1;
    } catch (error) {
      remaining.push(entry);
      warnings.push(safeMessage(error));
    }
  }
  let gitHelper = 'none';
  let helperRecord = null;
  if (ctx.gitHelper) {
    try {
      const current = gitHelperValues(exec);
      if (!current) {
        gitHelper = 'git-unavailable';
        helperRecord = ctx.gitHelper;
      } else if (ownedHelper(ctx, current)) {
        for (const key of HELPER_KEYS) {
          if (current[key].length > 0) run(exec, 'git', ['config', '--global', '--unset-all', key]);
        }
        gitHelper = 'removed';
      } else {
        gitHelper = 'preserved';
      }
    } catch (error) {
      gitHelper = 'failed';
      helperRecord = ctx.gitHelper;
      warnings.push(safeMessage(error));
    }
  }
  persist(ctx, remaining, helperRecord);
  return { removed, preserved, retained: remaining.length, gitHelper, warnings };
}
