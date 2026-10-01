import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { HELPER_KEYS, RosterError, childEnv, parseHostsLogins, redact, removeGithubAccounts, syncGithubAccounts } from './gh-accounts.mjs';

const homes = [];
const home = () => {
  const path = mkdtempSync(join(tmpdir(), 'alfe-github-cli-'));
  homes.push(path);
  return path;
};
afterEach(() => { for (const path of homes.splice(0)) rmSync(path, { recursive: true, force: true }); });

const ledgerPath = (root) => join(root, '.alfe', 'github-cli', 'owned-accounts.json');
const ledger = (root) => JSON.parse(readFileSync(ledgerPath(root), 'utf8'));
const owners = new Map();
const token = (login, n = 1) => {
  const value = `gho_${login.replace(/-/gu, '')}Token${'x'.repeat(24)}${n}`;
  owners.set(value, login);
  return value;
};
const account = (login, n = 1) => ({ connectionId: `con_${login}`, accountIdentifier: login, displayName: null, connectedAt: '2026-10-01T00:00:00Z', login, accessToken: token(login, n), scopes: 'repo' });
const GH_PATH_HELPER = '!/usr/bin/gh auth git-credential';

/**
 * In-memory gh + git: multi-account hosts state, git global config, and a full
 * call log. Tokens are only accepted on stdin, mirroring the real CLI usage.
 */
class FakeCli {
  constructor({ version = '2.74.2', installed = true, gitInstalled = true } = {}) {
    this.version = version;
    this.installed = installed;
    this.gitInstalled = gitInstalled;
    this.users = new Map();
    this.active = undefined;
    this.git = new Map();
    this.calls = [];
    this.failOn = undefined;
    this.renamed = new Map();
    this.clock = 0;
    this.tick = 0;
    this.onLogin = undefined;
  }

  // gh's local hosts.yml view, used for case-insensitive resolution.
  listLogins = () => [...this.users.keys()];
  now = () => this.clock;

  exec = (file, args, options = {}) => {
    this.calls.push({ file, args: [...args], input: options.input });
    this.clock += this.tick;
    const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
    const fail = (stderr, status = 1) => ({ status, stdout: '', stderr });
    if (this.failOn?.(file, args)) return fail(`injected failure; token was ${options.input ?? ''}`);
    if (file === 'git') {
      if (!this.gitInstalled) return { status: null, stdout: '', stderr: '', missing: true };
      const [, , op, key] = args;
      if (op === '--get-all') {
        const values = this.git.get(key);
        return values?.length ? ok(`${values.join('\n')}\n`) : fail('', 1);
      }
      if (op === '--unset-all') { this.git.delete(key); return ok(); }
      return fail('unsupported git call', 2);
    }
    if (!this.installed) return { status: null, stdout: '', stderr: '', missing: true };
    const flag = (name) => args[args.indexOf(name) + 1];
    const cmd = args.slice(0, 2).join(' ');
    if (args[0] === '--version') return ok(`gh version ${this.version} (2026-01-01)\n`);
    if (cmd === 'auth token') {
      const value = this.users.get(flag('--user'));
      return value ? ok(`${value}\n`) : fail(`no oauth token found for github.com account ${flag('--user')}`);
    }
    if (cmd === 'config get') return this.active ? ok(`${this.active}\n`) : fail('could not find key "user"');
    if (cmd === 'auth login') {
      const value = (options.input ?? '').trim();
      const login = this.renamed.get(value) ?? owners.get(value);
      if (!login) return fail('error validating token');
      this.users.set(login, value);
      this.active = login;
      this.onLogin?.();
      return ok();
    }
    if (cmd === 'auth switch') {
      if (!this.users.has(flag('--user'))) return fail('not logged in');
      this.active = flag('--user');
      return ok();
    }
    if (cmd === 'auth logout') {
      const login = flag('--user');
      if (!this.users.delete(login)) return fail(`not logged in to github.com account ${login}`);
      if (this.active === login) this.active = this.users.keys().next().value;
      return ok();
    }
    if (cmd === 'auth setup-git') {
      for (const key of HELPER_KEYS) this.git.set(key, ['', GH_PATH_HELPER]);
      return ok();
    }
    return fail(`unsupported gh call ${args.join(' ')}`, 2);
  };

  mutations() {
    return this.calls.filter(({ file, args }) => file === 'gh'
      ? ['auth login', 'auth logout', 'auth switch', 'auth setup-git'].includes(args.slice(0, 2).join(' '))
      : args.includes('--unset-all'));
  }
}

const sync = (root, cli, accounts) => syncGithubAccounts({ home: root, response: { accounts }, exec: cli.exec, listLogins: cli.listLogins, now: cli.now, platform: 'linux' });

test('multi-account login stores every roster token and activates the first roster account', () => {
  const root = home();
  const cli = new FakeCli();
  const result = sync(root, cli, [account('primary'), account('org-bot')]);
  assert.equal(cli.users.get('primary'), token('primary'));
  assert.equal(cli.users.get('org-bot'), token('org-bot'));
  assert.equal(cli.active, 'primary');
  assert.equal(result.loggedIn, 2);
  assert.equal(result.active, 'primary');
  assert.equal(result.gitHelper, 'configured');
  for (const key of HELPER_KEYS) assert.deepEqual(cli.git.get(key), ['', GH_PATH_HELPER]);
  const login = cli.calls.find(({ args }) => args[1] === 'login');
  assert.deepEqual(login.args, ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--with-token', '--insecure-storage']);
  assert.deepEqual(ledger(root).accounts.map((entry) => entry.login), ['primary', 'org-bot']);
  assert.equal(statSync(ledgerPath(root)).mode & 0o777, 0o600);
  assert.equal(statSync(join(root, '.alfe', 'github-cli')).mode & 0o777, 0o700);
});

test('tokens travel only on stdin: never in argv, the ledger, results, or errors', () => {
  const root = home();
  const cli = new FakeCli();
  const accounts = [account('primary'), account('org-bot')];
  const result = sync(root, cli, accounts);
  const secrets = accounts.map((entry) => entry.accessToken);
  for (const { args, input } of cli.calls) {
    for (const secret of secrets) assert.ok(!args.join(' ').includes(secret));
    if (args[1] === 'login') assert.ok(secrets.includes(input.trim()));
  }
  const persisted = readFileSync(ledgerPath(root), 'utf8') + JSON.stringify(result);
  for (const secret of secrets) assert.ok(!persisted.includes(secret));
  // A failing login whose stderr echoes the token must not leak it in the warning.
  const other = new FakeCli();
  other.failOn = (file, args) => args[1] === 'login';
  const failed = sync(home(), other, accounts);
  assert.equal(failed.warnings.length, 2);
  for (const warning of failed.warnings) {
    for (const secret of secrets) assert.ok(!warning.includes(secret));
    assert.match(warning, /\[REDACTED\]/u);
  }
});

test('child environment drops ambient token overrides and disables prompts', () => {
  const env = childEnv({ PATH: '/usr/bin', GH_TOKEN: 'a', GITHUB_TOKEN: 'b', GH_ENTERPRISE_TOKEN: 'c', GITHUB_ENTERPRISE_TOKEN: 'd', GH_HOST: 'evil.example' });
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST']) assert.equal(env[key], undefined);
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.GH_PROMPT_DISABLED, '1');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(redact('x ghp_abcdefghijklmnopqrstuvwx y github_pat_abcdefghijklmnopqrstuv z'), 'x [REDACTED] y [REDACTED] z');
});

test('re-running with the same roster is idempotent and issues no gh mutation', () => {
  const root = home();
  const cli = new FakeCli();
  sync(root, cli, [account('primary'), account('org-bot')]);
  const before = cli.mutations().length;
  const first = ledger(root);
  const result = sync(root, cli, [account('primary'), account('org-bot')]);
  assert.equal(cli.mutations().length, before);
  assert.deepEqual(ledger(root), first);
  assert.equal(result.unchanged, 2);
  assert.equal(result.gitHelper, 'owned');
});

test('token rotation re-authenticates only the owned login whose token changed', () => {
  const root = home();
  const cli = new FakeCli();
  sync(root, cli, [account('primary'), account('org-bot')]);
  cli.calls.length = 0;
  sync(root, cli, [account('primary', 2), account('org-bot')]);
  assert.equal(cli.users.get('primary'), token('primary', 2));
  assert.equal(cli.calls.filter(({ args }) => args[1] === 'login').length, 1);
  assert.equal(ledger(root).accounts.find((entry) => entry.login === 'primary').previousSha256, undefined);
});

test('removed roster accounts are logged out only when owned; user-added accounts survive', () => {
  const root = home();
  const cli = new FakeCli();
  cli.users.set('human', 'gho_humanOwnToken000000000000000000');
  cli.active = 'human';
  sync(root, cli, [account('primary'), account('org-bot')]);
  // The user's own active choice is restored after hook logins.
  assert.equal(cli.active, 'human');
  const result = sync(root, cli, [account('primary')]);
  assert.equal(cli.users.has('org-bot'), false);
  assert.equal(cli.users.get('human'), 'gho_humanOwnToken000000000000000000');
  assert.equal(result.removed, 1);
  assert.deepEqual(ledger(root).accounts.map((entry) => entry.login), ['primary']);
  assert.ok(!cli.calls.some(({ args }) => args[1] === 'logout' && args.includes('human')));
});

test('a roster login the user already logged in is preserved and never claimed', () => {
  const root = home();
  const cli = new FakeCli();
  cli.users.set('primary', 'gho_userOwnPrimaryToken0000000000000');
  const result = sync(root, cli, [account('primary')]);
  assert.equal(cli.users.get('primary'), 'gho_userOwnPrimaryToken0000000000000');
  assert.equal(result.preserved, 1);
  assert.deepEqual(ledger(root).accounts, []);
  sync(root, cli, []);
  removeGithubAccounts({ home: root, exec: cli.exec, listLogins: cli.listLogins });
  assert.equal(cli.users.get('primary'), 'gho_userOwnPrimaryToken0000000000000');
});

test('an owned login the user re-authenticated is released, not overwritten or logged out', () => {
  const root = home();
  const cli = new FakeCli();
  sync(root, cli, [account('primary'), account('org-bot')]);
  cli.users.set('org-bot', 'gho_userReplacedToken000000000000000');
  sync(root, cli, [account('primary'), account('org-bot', 3)]);
  assert.equal(cli.users.get('org-bot'), 'gho_userReplacedToken000000000000000');
  assert.deepEqual(ledger(root).accounts.map((entry) => entry.login), ['primary']);
  sync(root, cli, [account('primary')]);
  assert.equal(cli.users.get('org-bot'), 'gho_userReplacedToken000000000000000');
});

test('previously active owned account stays active when roster order changes', () => {
  const root = home();
  const cli = new FakeCli();
  sync(root, cli, [account('primary'), account('org-bot')]);
  sync(root, cli, [account('newer'), account('primary'), account('org-bot')]);
  assert.equal(cli.active, 'primary');
  // When the active account leaves the roster, the first roster account wins.
  sync(root, cli, [account('newer'), account('org-bot')]);
  assert.equal(cli.active, 'newer');
});

test('invalid or incomplete responses are rejected before any gh call', () => {
  const root = home();
  const cli = new FakeCli();
  sync(root, cli, [account('primary')]);
  const before = { calls: cli.calls.length, ledger: readFileSync(ledgerPath(root), 'utf8') };
  const invalid = [
    undefined, {}, { accounts: 'nope' }, { accounts: [{}] },
    { accounts: [account('primary'), { ...account('other'), accessToken: '' }] },
    { accounts: [{ ...account('bad'), login: '../escape' }] },
    { accounts: [{ ...account('bad'), login: '-leading' }] },
    { accounts: [{ ...account('bad'), accessToken: 'tok with space' }] },
    { accounts: [{ ...account('bad'), accessToken: 'tok\nnext' }] },
    { accounts: [account('primary'), account('PRIMARY')] },
    { accounts: Array.from({ length: 65 }, (_, i) => account(`user${i}`)) },
  ];
  for (const response of invalid) {
    assert.throws(() => syncGithubAccounts({ home: root, response, exec: cli.exec, listLogins: cli.listLogins }));
    assert.equal(cli.calls.length, before.calls);
    assert.equal(readFileSync(ledgerPath(root), 'utf8'), before.ledger);
  }
  assert.equal(cli.users.get('primary'), token('primary'));
});

test('a gh-side login failure is a warning; other steps proceed and the next run converges', () => {
  const root = home();
  const cli = new FakeCli();
  sync(root, cli, [account('primary'), account('org-bot')]);
  cli.failOn = (file, args) => args[1] === 'login' && cli.calls.at(-1).input?.includes('newacct');
  const result = sync(root, cli, [account('primary'), account('newacct')]);
  assert.equal(result.warnings.length, 1);
  // The roster is valid, so the stale owned account is still removed.
  assert.equal(cli.users.has('org-bot'), false);
  assert.equal(cli.users.has('newacct'), false);
  assert.deepEqual(ledger(root).accounts.map((entry) => entry.login), ['primary']);
  cli.failOn = undefined;
  sync(root, cli, [account('primary'), account('newacct')]);
  assert.equal(cli.users.has('org-bot'), false);
  assert.deepEqual(ledger(root).accounts.map((entry) => entry.login).sort(), ['newacct', 'primary']);
});

test('interrupted token replacement keeps both owned digests recognisable', () => {
  for (const landed of [true, false]) {
    const root = home();
    const cli = new FakeCli();
    sync(root, cli, [account('primary'), account('second')]);
    // Capture the write-ahead ledger as the replacement login runs, then
    // restore it afterwards: the state a crash before finalisation leaves.
    let writeAhead;
    cli.onLogin = () => { writeAhead = readFileSync(ledgerPath(root), 'utf8'); };
    sync(root, cli, [account('primary', 2), account('second')]);
    cli.onLogin = undefined;
    writeFileSync(ledgerPath(root), writeAhead);
    const entry = ledger(root).accounts.find((item) => item.login === 'primary');
    assert.ok(entry.previousSha256);
    // Simulate a crash on either side of gh's write.
    if (!landed) cli.users.set('primary', token('primary', 1));
    // Either digest is still "ours": an empty roster logs the account out.
    sync(root, cli, []);
    assert.equal(cli.users.has('primary'), false);
    assert.equal(cli.users.has('second'), false);
  }
});

test('a renamed login leaves no stray gh account and restores the active account', () => {
  const root = home();
  const cli = new FakeCli();
  cli.users.set('human', 'gho_humanOwnToken000000000000000000');
  cli.active = 'human';
  cli.renamed.set(token('oldname'), 'newname');
  const result = sync(root, cli, [account('oldname'), account('primary')]);
  assert.match(result.warnings.join('\n'), /renamed.*removed the unexpected gh account newname/u);
  assert.deepEqual([...cli.users.keys()].sort(), ['human', 'primary']);
  assert.equal(cli.active, 'human');
  assert.deepEqual(ledger(root).accounts.map((entry) => entry.login), ['primary']);
  // A renamed account that collides with a pre-existing user account is untouched.
  const other = home();
  const cli2 = new FakeCli();
  cli2.users.set('newname', 'gho_userNewnameToken0000000000000000');
  cli2.renamed.set(token('oldname'), 'newname');
  const second = sync(other, cli2, [account('oldname')]);
  assert.match(second.warnings[0], /renamed/u);
  assert.equal(cli2.users.has('newname'), true);
  assert.deepEqual(ledger(other).accounts, []);
});

test('logins match case-insensitively across roster, ledger and gh', () => {
  const root = home();
  const cli = new FakeCli();
  const mixed = (login, n = 1) => ({ ...account('primary', n), login });
  sync(root, cli, [mixed('PRIMARY')]);
  assert.deepEqual([...cli.users.keys()], ['primary']);
  // The ledger records gh's spelling so health and uninstall match exactly.
  assert.deepEqual(ledger(root).accounts.map((entry) => entry.login), ['primary']);
  const before = cli.mutations().length;
  const again = sync(root, cli, [mixed('Primary')]);
  assert.equal(again.unchanged, 1);
  assert.equal(cli.mutations().length, before);
  // A differently-cased user account is still the user's.
  const other = home();
  const cli2 = new FakeCli();
  cli2.users.set('Human', 'gho_humanOwnToken000000000000000000');
  assert.equal(sync(other, cli2, [{ ...account('human'), login: 'HUMAN' }]).preserved, 1);
  assert.equal(cli2.users.get('Human'), 'gho_humanOwnToken000000000000000000');
  sync(root, cli, []);
  assert.equal(cli.users.has('primary'), false);
});

test('roster problems are RosterError; gh-side problems are warnings or non-roster errors', () => {
  assert.throws(() => sync(home(), new FakeCli(), [{ login: 'x' }]), RosterError);
  const cli = new FakeCli();
  cli.failOn = (file, args) => args[0] === '--version';
  assert.throws(() => sync(home(), cli, [account('primary')]), (error) => !(error instanceof RosterError));
  const flaky = new FakeCli();
  flaky.failOn = (file, args) => args[1] === 'setup-git';
  const result = sync(home(), flaky, [account('primary')]);
  assert.equal(result.gitHelper, 'failed');
  assert.equal(result.warnings.length, 1);
});

test('the hook deadline stops new network calls; state stays consistent and the next run continues', () => {
  const root = home();
  const cli = new FakeCli();
  cli.tick = 1_000; // every gh/git call costs 1 s of the 25 s budget
  const roster = Array.from({ length: 8 }, (_, i) => account(`user${i}`));
  const first = sync(root, cli, roster);
  assert.ok(first.loggedIn > 0 && first.loggedIn < roster.length, String(first.loggedIn));
  assert.match(first.warnings.join('\n'), /budget/u);
  // Only verifiably stored logins are owned; nothing unowned leaked.
  assert.deepEqual(ledger(root).accounts.map((entry) => entry.login).sort(), [...cli.users.keys()].sort());
  cli.tick = 0;
  const second = sync(root, cli, roster);
  assert.equal(second.warnings.length, 0);
  assert.equal(cli.users.size, roster.length);
});

test('uninstall with a broken gh keeps the ledger and does not throw', () => {
  const root = home();
  const cli = new FakeCli();
  sync(root, cli, [account('primary')]);
  cli.failOn = (file) => file === 'gh';
  const result = removeGithubAccounts({ home: root, exec: cli.exec, listLogins: cli.listLogins });
  assert.equal(result.retained, 1);
  assert.ok(result.warnings.length >= 1);
  assert.deepEqual(ledger(root).accounts.map((entry) => entry.login), ['primary']);
  assert.equal(cli.users.get('primary'), token('primary'));
  cli.failOn = undefined;
  removeGithubAccounts({ home: root, exec: cli.exec, listLogins: cli.listLogins });
  assert.equal(cli.users.has('primary'), false);
});

test('hosts.yml parser reads gh multi-account layouts and rejects surprises', () => {
  const gh = 'github.com:\n    users:\n        alice:\n            oauth_token: x\n        bob: {}\n    git_protocol: https\n    user: bob\nghe.example.com:\n    users:\n        carol:\n';
  assert.deepEqual(parseHostsLogins(gh), ['alice', 'bob']);
  assert.deepEqual(parseHostsLogins('github.com:\n    oauth_token: x\n    user: legacy\n'), ['legacy']);
  assert.deepEqual(parseHostsLogins('{}\n'), []);
  // YAML quotes keys that would otherwise not be strings, e.g. all-digit logins.
  assert.deepEqual(parseHostsLogins('github.com:\n    users:\n        "12345":\n            oauth_token: x\n        \'0042\': {}\n        plain:\n'), ['12345', '0042', 'plain']);
  assert.deepEqual(parseHostsLogins('github.com:\n    oauth_token: x\n    user: "12345"\n'), ['12345']);
  assert.throws(() => parseHostsLogins('github.com:\n    users:\n        - alice\n'));
});

test('missing or pre-multi-account gh skips without mutation; missing git skips the helper', () => {
  for (const cli of [new FakeCli({ installed: false }), new FakeCli({ version: '2.39.9' })]) {
    const root = home();
    const result = sync(root, cli, [account('primary')]);
    assert.ok(result.skipped);
    assert.equal(cli.mutations().length, 0);
  }
  const root = home();
  const cli = new FakeCli({ gitInstalled: false });
  const result = sync(root, cli, [account('primary')]);
  assert.equal(result.gitHelper, 'git-unavailable');
  assert.equal(cli.users.get('primary'), token('primary'));
});

test('an existing user credential helper is left alone and never claimed', () => {
  const root = home();
  const cli = new FakeCli();
  cli.git.set(HELPER_KEYS[0], ['store']);
  const result = sync(root, cli, [account('primary')]);
  assert.equal(result.gitHelper, 'external');
  assert.ok(!cli.calls.some(({ args }) => args[1] === 'setup-git'));
  removeGithubAccounts({ home: root, exec: cli.exec, listLogins: cli.listLogins });
  assert.deepEqual(cli.git.get(HELPER_KEYS[0]), ['store']);
});

test('uninstall removes only owned accounts and an unmodified owned git helper', () => {
  const root = home();
  const cli = new FakeCli();
  cli.users.set('human', 'gho_humanOwnToken000000000000000000');
  sync(root, cli, [account('primary'), account('org-bot')]);
  const result = removeGithubAccounts({ home: root, exec: cli.exec, listLogins: cli.listLogins });
  assert.deepEqual([...cli.users.keys()], ['human']);
  for (const key of HELPER_KEYS) assert.equal(cli.git.has(key), false);
  assert.equal(result.removed, 2);
  assert.equal(result.gitHelper, 'removed');
  assert.deepEqual(ledger(root), { version: 1, accounts: [], gitHelper: null });
  // Idempotent: a second uninstall is a no-op.
  const again = removeGithubAccounts({ home: root, exec: cli.exec, listLogins: cli.listLogins });
  assert.equal(again.removed, 0);
});

test('uninstall preserves a modified helper and a re-authenticated owned account', () => {
  const root = home();
  const cli = new FakeCli();
  sync(root, cli, [account('primary')]);
  cli.git.set(HELPER_KEYS[0], ['', '!/custom/helper']);
  cli.users.set('primary', 'gho_userReplacedToken000000000000000');
  const result = removeGithubAccounts({ home: root, exec: cli.exec, listLogins: cli.listLogins });
  assert.equal(result.preserved, 1);
  assert.equal(result.gitHelper, 'preserved');
  assert.deepEqual(cli.git.get(HELPER_KEYS[0]), ['', '!/custom/helper']);
  assert.equal(cli.users.get('primary'), 'gho_userReplacedToken000000000000000');
});

test('pending git helper record from an interrupted setup is adopted only if gh-shaped', () => {
  const root = home();
  const cli = new FakeCli();
  sync(root, cli, [account('primary')]);
  writeFileSync(ledgerPath(root), JSON.stringify({ version: 1, accounts: ledger(root).accounts, gitHelper: { pending: true } }));
  removeGithubAccounts({ home: root, exec: cli.exec, listLogins: cli.listLogins });
  for (const key of HELPER_KEYS) assert.equal(cli.git.has(key), false);

  const other = home();
  const cli2 = new FakeCli();
  cli2.git.set(HELPER_KEYS[0], ['osxkeychain']);
  mkdirSync(join(other, '.alfe', 'github-cli'), { recursive: true });
  writeFileSync(ledgerPath(other), JSON.stringify({ version: 1, accounts: [], gitHelper: { pending: true } }));
  removeGithubAccounts({ home: other, exec: cli2.exec, listLogins: cli2.listLogins });
  assert.deepEqual(cli2.git.get(HELPER_KEYS[0]), ['osxkeychain']);
});

test('malformed or symlinked ledger refuses to act', () => {
  const root = home();
  const cli = new FakeCli();
  mkdirSync(join(root, '.alfe', 'github-cli'), { recursive: true });
  for (const bad of ['{', '{"version":2,"accounts":[]}', '{"version":1,"accounts":[{"login":"x"}]}',
    '{"version":1,"accounts":[],"gitHelper":{"values":{}}}']) {
    writeFileSync(ledgerPath(root), bad);
    assert.throws(() => sync(root, cli, [account('primary')]));
    assert.throws(() => removeGithubAccounts({ home: root, exec: cli.exec, listLogins: cli.listLogins }));
  }
  assert.equal(cli.mutations().length, 0);
  const linked = home();
  const target = home();
  mkdirSync(join(linked, '.alfe'), { recursive: true });
  symlinkSync(target, join(linked, '.alfe', 'github-cli'));
  assert.throws(() => sync(linked, new FakeCli(), [account('primary')]), /real directory/u);
});

test('a renamed account whose logout fails stays owned, so a later run or uninstall removes it', () => {
  const root = home();
  const cli = new FakeCli();
  cli.renamed.set(token('oldname'), 'newname');
  cli.failOn = (file, args) => args[1] === 'logout' && args.includes('newname');
  const result = sync(root, cli, [account('oldname')]);
  assert.ok(result.warnings.some((warning) => /renamed/u.test(warning)));
  assert.equal(cli.users.has('newname'), true);
  assert.deepEqual(ledger(root).accounts.map((entry) => entry.login), ['newname']);
  cli.failOn = undefined;
  removeGithubAccounts({ home: root, exec: cli.exec, listLogins: cli.listLogins });
  assert.equal(cli.users.has('newname'), false);
});
