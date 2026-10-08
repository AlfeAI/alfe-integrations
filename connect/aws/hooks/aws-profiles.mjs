import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  accessSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';

/**
 * Mirror the agent's Connect AWS profile roster into a managed block of
 * ~/.aws/config: one `credential_process` profile per identity, each calling
 * `alfe aws credentials` (which mints short-lived STS credentials through the
 * Alfe API). No secret is ever written by this module. See ../DEVELOPING.md
 * for the ownership rules it enforces.
 */

export const BLOCK_BEGIN = '# >>> alfe managed (do not edit) >>>';
export const BLOCK_END = '# <<< alfe managed <<<';

// Validators shared with services/connect and the CLI (wire contract).
export const PROFILE = /^[a-z0-9][a-z0-9_-]{0,62}$/u;
export const REGION = /^(?!cn-)[a-z]{2}-[a-z]+-\d$/u;
export const ROLE_ARN = /^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]{1,512}$/u;
export const ACCOUNT_ID = /^\d{12}$/u;
export const CONNECTION_ID = /^[A-Za-z0-9_-]{1,128}$/u;
// The alfe path is written unquoted into credential_process, which the AWS CLI
// splits shell-style: allow only characters that need no quoting.
export const SAFE_PATH = /^\/[A-Za-z0-9._/+@-]{1,1024}$/u;

const MAX_PROFILES = 256;
// Interrupted runs may leave a union of rosters in the ledger; bound reads.
const MAX_OWNED = 1024;
const MAX_STRING = 4096;

// The daemon kills post_activate at 30 s from spawn (HOOK_TIMEOUT_MS).
export const HOOK_BUDGET_MS = 25_000;
export const FETCH_TIMEOUT_MS = 10_000;
export const PROBE_TIMEOUT_MS = 8_000;

/** Error whose message holds no secret and is safe to print. */
export class AwsHookError extends Error {}
/** The authoritative roster is unusable: the only failure that fails activation. */
export class RosterError extends AwsHookError {}

/** Cache entry the CLI writes for (connectionId, profile); see `alfe aws credentials`. */
export function cacheFileName(connectionId, profile) {
  return `${createHash('sha256').update(`${connectionId}\0${profile}`).digest('hex')}.json`;
}

const hasLineBreak = (value) => /[\r\n]/u.test(value);

/** Reject any string anywhere in the entry that carries a line break or is unbounded. */
function assertPlainStrings(value, depth = 0) {
  if (depth > 4) throw new RosterError('AWS profile entry is nested too deeply');
  if (typeof value === 'string') {
    if (hasLineBreak(value)) throw new RosterError('AWS profile entry contains a line break');
    if (value.length > MAX_STRING) throw new RosterError('AWS profile entry contains an oversized value');
    return;
  }
  if (Array.isArray(value)) { for (const item of value) assertPlainStrings(item, depth + 1); return; }
  if (value && typeof value === 'object') for (const item of Object.values(value)) assertPlainStrings(item, depth + 1);
}

/**
 * Validate the COMPLETE roster before anything is mutated, then dedup by
 * profile (first wins: Connect orders by most specific scope, then most
 * recent). Any invalid entry rejects the whole roster.
 */
export function validateRoster(response) {
  const entries = Array.isArray(response) ? response : response?.accounts;
  if (!Array.isArray(entries) || entries.length > MAX_PROFILES) {
    throw new RosterError('AWS profiles response must be a complete bounded array');
  }
  const profiles = [];
  const warnings = [];
  const seen = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new RosterError('Invalid AWS profile entry');
    assertPlainStrings(entry);
    const { profile, region, connectionId, accountId, roleArn } = entry;
    if (typeof profile !== 'string' || !PROFILE.test(profile) || profile === 'default') throw new RosterError('Invalid AWS profile name');
    if (typeof region !== 'string' || !REGION.test(region)) throw new RosterError(`Invalid region for AWS profile ${profile}`);
    if (typeof connectionId !== 'string' || !CONNECTION_ID.test(connectionId)) throw new RosterError(`Invalid connectionId for AWS profile ${profile}`);
    if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId)) throw new RosterError(`Invalid accountId for AWS profile ${profile}`);
    if (roleArn !== null && (typeof roleArn !== 'string' || !ROLE_ARN.test(roleArn))) throw new RosterError(`Invalid roleArn for AWS profile ${profile}`);
    if (entry.label !== undefined && entry.label !== null && typeof entry.label !== 'string') throw new RosterError(`Invalid label for AWS profile ${profile}`);
    const first = seen.get(profile);
    if (first) {
      warnings.push(`AWS profile "${profile}" is provided by more than one connection; using ${first} and ignoring ${connectionId}. Rename one of them in the dashboard.`);
      continue;
    }
    seen.set(profile, connectionId);
    profiles.push({ profile, region, connectionId, accountId, roleArn });
  }
  return { profiles, warnings };
}

/** Absolute path of an executable on PATH (like `command -v`), or undefined. */
export function resolveExecutable(name, env = process.env) {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    const candidate = join(dir, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* not here */ }
  }
  return undefined;
}

/**
 * Capability probe: an older CLI without `alfe aws` would turn every managed
 * profile into "unknown command", so the block is only written when this passes.
 */
export function probeAlfeAws(alfePath, timeout = PROBE_TIMEOUT_MS) {
  const result = spawnSync(alfePath, ['aws', '--help'], { stdio: 'ignore', timeout, windowsHide: true });
  return !result.error && result.status === 0;
}

/**
 * Can this host run the profiles' credential_process? Needs an `alfe` on PATH,
 * at a path usable unquoted in ~/.aws/config, whose CLI has `alfe aws`. Local
 * only. Shared by post_activate (exit 1, so the daemon re-activates later) and
 * health (unhealthy until the CLI is upgraded). Messages are safe to print.
 */
export function checkAlfeCli({ env = process.env, timeout = PROBE_TIMEOUT_MS } = {}) {
  const alfePath = resolveExecutable('alfe', env);
  if (!alfePath) return { ok: false, message: 'the alfe CLI was not found on PATH' };
  if (!SAFE_PATH.test(alfePath)) {
    return { ok: false, message: 'the alfe CLI path contains characters that cannot be used unquoted in credential_process' };
  }
  if (!probeAlfeAws(alfePath, timeout)) {
    return { ok: false, message: 'the installed alfe CLI does not support `alfe aws`; upgrade @alfe.ai/cli' };
  }
  return { ok: true, alfePath };
}

// ── Config file parsing ─────────────────────────────────────────

/** Lines with their terminators, so unchanged regions are reproduced byte-for-byte. */
function lines(text) {
  return text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
}
const bare = (line) => line.replace(/\r?\n$/u, '');

/**
 * Split config text into what precedes the managed block, the block (marker
 * lines included), and what follows. A malformed block (unbalanced or
 * repeated markers) throws: we never guess which lines are ours.
 */
export function splitManagedBlock(text) {
  const all = lines(text);
  const begins = [];
  const ends = [];
  all.forEach((line, index) => {
    const value = bare(line).trimEnd();
    if (value === BLOCK_BEGIN) begins.push(index);
    else if (value === BLOCK_END) ends.push(index);
  });
  if (begins.length === 0 && ends.length === 0) return { present: false, before: text, block: '', after: '' };
  if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) {
    throw new AwsHookError('The alfe managed block in the AWS config file is malformed (unbalanced or repeated markers); fix or delete it by hand');
  }
  return {
    present: true,
    before: all.slice(0, begins[0]).join(''),
    block: all.slice(begins[0], ends[0] + 1).join(''),
    after: all.slice(ends[0] + 1).join(''),
  };
}

/**
 * Profile names a section header defines outside our block. Conservative: a
 * bare `[name]` counts too (it is a profile in the credentials file, and we
 * never want ambiguity in the config file either).
 */
export function sectionProfiles(text) {
  const names = new Set();
  for (const line of lines(text)) {
    const match = /^\s*\[\s*([^\]]*?)\s*\]/u.exec(bare(line));
    if (!match) continue;
    const inner = match[1];
    if (/^(sso-session|services)\s/u.test(inner)) continue;
    const profile = /^profile\s+(.+)$/u.exec(inner);
    names.add((profile ? profile[1] : inner).trim());
  }
  return names;
}

/** Render the managed block for `profiles` (never empty: no profiles means no block). */
export function renderBlock(profiles, alfePath) {
  const sections = profiles.map(({ profile, region, connectionId }) => [
    `[profile ${profile}]`,
    `region = ${region}`,
    `credential_process = ${alfePath} aws credentials --connection ${connectionId} --profile ${profile}`,
  ].join('\n'));
  return `${BLOCK_BEGIN}\n${sections.join('\n\n')}\n${BLOCK_END}\n`;
}

/**
 * Parse a managed block back into profiles. Throws on anything we would not
 * have written ourselves (health uses this to detect hand edits).
 */
export function parseBlock(block) {
  const body = lines(block).map((line) => bare(line).trimEnd());
  if (body[0] !== BLOCK_BEGIN || body[body.length - 1] !== BLOCK_END) throw new AwsHookError('Managed block markers are missing');
  const profiles = [];
  let current;
  for (const line of body.slice(1, -1)) {
    if (line === '') continue;
    const header = /^\[profile ([^\]]+)\]$/u.exec(line);
    if (header) {
      if (current && (!current.region || !current.credentialProcess)) throw new AwsHookError(`Managed profile ${current.profile} is incomplete`);
      if (!PROFILE.test(header[1]) || header[1] === 'default') throw new AwsHookError('Managed block contains an invalid profile name');
      if (profiles.some((p) => p.profile === header[1])) throw new AwsHookError(`Managed block repeats profile ${header[1]}`);
      current = { profile: header[1] };
      profiles.push(current);
      continue;
    }
    if (!current) throw new AwsHookError('Managed block has settings outside a profile');
    const region = /^region = (\S+)$/u.exec(line);
    if (region && REGION.test(region[1]) && !current.region) { current.region = region[1]; continue; }
    const proc = /^credential_process = (\S+) aws credentials --connection (\S+) --profile (\S+)$/u.exec(line);
    if (proc && !current.credentialProcess && SAFE_PATH.test(proc[1]) && CONNECTION_ID.test(proc[2]) && proc[3] === current.profile) {
      current.credentialProcess = proc[1];
      current.connectionId = proc[2];
      continue;
    }
    throw new AwsHookError(`Managed block contains an unexpected line in profile ${current.profile}`);
  }
  if (current && (!current.region || !current.credentialProcess)) throw new AwsHookError(`Managed profile ${current.profile} is incomplete`);
  return profiles;
}

// ── Filesystem helpers ──────────────────────────────────────────

function realDirectory(path, label) {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AwsHookError(`${label} must be a real directory`);
  return path;
}

function readRegular(path, label) {
  let stat;
  try { stat = lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new AwsHookError(`${label} must be a regular file`);
  return readFileSync(path, 'utf8');
}

function writeAtomic(path, text) {
  const temporary = join(dirname(path), `.${randomUUID()}.alfe.tmp`);
  try {
    writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/**
 * Real path of ~/.aws/config: follows a symlinked config to its target (the
 * link is preserved because we replace the target). Creates ~/.aws (0700)
 * when missing. A config that is not a regular file is an error.
 */
export function resolveConfigPath(home, { create = true } = {}) {
  const awsDir = join(realpathSync(home), '.aws');
  if (!existsSync(awsDir)) {
    if (!create) return undefined;
    mkdirSync(awsDir, { mode: 0o700 });
  }
  const link = join(realpathSync(awsDir), 'config');
  let path = link;
  if (isLink(link)) {
    try { path = realpathSync(link); } catch { throw new AwsHookError('~/.aws/config is a dangling symlink'); }
  }
  if (existsSync(path) && !statSync(path).isFile()) throw new AwsHookError('~/.aws/config must be a regular file');
  return path;
}

function isLink(path) {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}

function stateDirectory(home) {
  const root = realpathSync(home);
  return realDirectory(join(realDirectory(join(root, '.alfe'), '~/.alfe'), 'aws-cli'), '~/.alfe/aws-cli');
}

const ledgerPath = (home) => join(realpathSync(home), '.alfe', 'aws-cli', 'owned-profiles.json');
const cacheDir = (home) => join(realpathSync(home), '.alfe', 'aws-cli', 'cache');

/** Owned (profile, connectionId) pairs, or [] when no ledger exists. Throws when unreadable. */
export function readLedger(home) {
  let text;
  try { text = readRegular(ledgerPath(home), 'AWS ownership record'); } catch (error) {
    if (error instanceof AwsHookError) throw error;
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw new AwsHookError('AWS ownership record is unreadable');
  }
  if (text === undefined) return [];
  let ledger;
  try { ledger = JSON.parse(text); } catch { throw new AwsHookError('AWS ownership record is unreadable'); }
  if (ledger?.version !== 1 || !Array.isArray(ledger.profiles) || ledger.profiles.length > MAX_OWNED
    || !ledger.profiles.every((p) => p && typeof p.profile === 'string' && PROFILE.test(p.profile)
      && typeof p.connectionId === 'string' && CONNECTION_ID.test(p.connectionId))) {
    throw new AwsHookError('AWS ownership record is unreadable');
  }
  return ledger.profiles.map(({ profile, connectionId }) => ({ profile, connectionId }));
}

function writeLedger(home, configPath, profiles) {
  stateDirectory(home);
  const path = ledgerPath(home);
  readRegular(path, 'AWS ownership record');
  writeAtomic(path, `${JSON.stringify({ version: 1, configPath, profiles }, null, 2)}\n`);
}

const pairKey = ({ profile, connectionId }) => `${connectionId}\0${profile}`;

/** Delete the CLI's cached STS credentials for each (profile, connectionId) pair. */
function pruneCache(home, pairs) {
  const dir = cacheDir(home);
  let pruned = 0;
  for (const pair of pairs) {
    const file = join(dir, cacheFileName(pair.connectionId, pair.profile));
    try {
      const stat = lstatSync(file);
      if (stat.isFile() || stat.isSymbolicLink()) { unlinkSync(file); pruned += 1; }
    } catch (error) {
      // Only "already gone" is fine. Anything else must abort the sync BEFORE the
      // ledger drops this pair, so the next activation still sees it as stale and
      // retries; otherwise the cached STS credentials would linger until expiry.
      if (error?.code !== 'ENOENT') {
        throw new AwsHookError(`Could not remove cached AWS credentials for profile ${pair.profile} (${error?.code ?? 'error'})`);
      }
    }
  }
  return pruned;
}

// ── Sync / remove ───────────────────────────────────────────────

/**
 * Rewrite the managed block for the validated `profiles`. Everything outside
 * the block is preserved byte-for-byte. Profiles whose name the user (or
 * another tool) defines outside the block are skipped with a WARNING.
 */
export function syncAwsProfiles({ home, profiles, alfePath }) {
  if (!SAFE_PATH.test(alfePath ?? '')) throw new AwsHookError('alfe CLI path contains characters that cannot be written into credential_process');
  const warnings = [];
  const configPath = resolveConfigPath(home);
  const original = readRegular(configPath, '~/.aws/config') ?? '';
  const parts = splitManagedBlock(original);

  // Names already taken outside our block: config, and the credentials file
  // (its keys would override our credential_process for the same profile).
  const taken = sectionProfiles(parts.before + parts.after);
  const credentialsPath = join(realpathSync(home), '.aws', 'credentials');
  try {
    const credentials = existsSync(credentialsPath) ? readFileSync(credentialsPath, 'utf8') : '';
    for (const name of sectionProfiles(credentials)) taken.add(name);
  } catch { warnings.push('~/.aws/credentials is unreadable; collisions with it were not checked'); }

  const written = [];
  for (const entry of profiles) {
    if (taken.has(entry.profile)) {
      warnings.push(`AWS profile "${entry.profile}" already exists outside the alfe managed block; it was left untouched and not managed. Rename the profile in the dashboard or remove the existing one.`);
      continue;
    }
    written.push(entry);
  }

  const owned = readLedger(home);
  const keep = new Set(written.map(pairKey));
  const stale = owned.filter((pair) => !keep.has(pairKey(pair)));
  const next = written.map(({ profile, connectionId }) => ({ profile, connectionId }));

  const block = written.length > 0 ? renderBlock(written, alfePath) : '';
  let text;
  if (parts.present) text = parts.before + block + parts.after;
  else if (block) text = original + (original && !original.endsWith('\n') ? '\n' : '') + block;
  else text = original;

  // Write-ahead: record the union before touching the config, so an
  // interrupted run still knows every cache entry it may need to prune.
  const union = [...next, ...stale].slice(0, MAX_OWNED);
  writeLedger(home, configPath, union);
  const changed = text !== original;
  if (changed) writeAtomic(configPath, text);
  const pruned = pruneCache(home, stale);
  writeLedger(home, configPath, next);

  return { configPath, written: written.map((p) => p.profile), skipped: profiles.length - written.length, removed: stale.length, pruned, changed, warnings };
}

/** Remove the managed block, ownership record and credential cache. The AWS CLI stays. */
export function removeAwsProfiles({ home }) {
  const warnings = [];
  let blockRemoved = false;
  const configPath = resolveConfigPath(home, { create: false });
  if (configPath && existsSync(configPath)) {
    const original = readRegular(configPath, '~/.aws/config') ?? '';
    const parts = splitManagedBlock(original);
    if (parts.present) {
      writeAtomic(configPath, parts.before + parts.after);
      blockRemoved = true;
    }
  }
  const state = join(realpathSync(home), '.alfe', 'aws-cli');
  let cacheRemoved = false;
  if (existsSync(state)) {
    const stat = lstatSync(state);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AwsHookError('~/.alfe/aws-cli must be a real directory');
    const cache = join(state, 'cache');
    if (existsSync(cache) || isLink(cache)) {
      // A symlinked cache is unlinked, never followed.
      if (lstatSync(cache).isSymbolicLink()) unlinkSync(cache);
      else rmSync(cache, { recursive: true, force: true });
      cacheRemoved = true;
    }
    rmSync(join(state, 'owned-profiles.json'), { force: true });
    try { if (readdirSync(state).length === 0) rmdirSync(state); } catch { /* keep */ }
  }
  return { blockRemoved, cacheRemoved, warnings };
}

/**
 * Local health of the managed block: well-formed when present, consistent
 * with the ownership record. Returns `{ ok, messages }`; never touches files.
 */
export function checkHealth({ home }) {
  const messages = [];
  let ledger;
  try { ledger = readLedger(home); } catch (error) {
    return { ok: false, messages: [`ERROR: ${error instanceof AwsHookError ? error.message : 'AWS ownership record is unreadable'}`] };
  }
  let configPath;
  try { configPath = resolveConfigPath(home, { create: false }); } catch (error) {
    return { ok: false, messages: [`ERROR: ${error instanceof AwsHookError ? error.message : 'AWS config path is unreadable'}`] };
  }
  if (!configPath || !existsSync(configPath)) {
    messages.push('No AWS config file; no Alfe-managed AWS profiles');
    return { ok: true, messages };
  }
  let profiles;
  try {
    const parts = splitManagedBlock(readRegular(configPath, '~/.aws/config') ?? '');
    if (!parts.present) {
      messages.push('No Alfe-managed AWS profiles');
      if (ledger.length > 0) messages.push('WARNING: the ownership record lists profiles but the managed block is missing; the next activation writes it again');
      return { ok: true, messages };
    }
    profiles = parseBlock(parts.block);
  } catch (error) {
    return { ok: false, messages: [`ERROR: ${error instanceof AwsHookError ? error.message : 'AWS config file is unreadable'}`] };
  }
  const owned = new Set(ledger.map(pairKey));
  const unowned = profiles.filter((p) => !owned.has(pairKey(p))).map((p) => p.profile);
  if (unowned.length > 0) messages.push(`WARNING: managed profiles missing from the ownership record: ${unowned.join(', ')}`);
  const missingCli = [...new Set(profiles.map((p) => p.credentialProcess))].filter((path) => {
    try { accessSync(path, constants.X_OK); return false; } catch { return true; }
  });
  if (missingCli.length > 0) messages.push(`WARNING: credential_process executable not found: ${missingCli.join(', ')}; the next activation rewrites it`);
  messages.push(`${profiles.length} Alfe-managed AWS profile(s): ${profiles.map((p) => p.profile).join(', ') || 'none'}`);
  return { ok: true, messages };
}
