import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { HELPER_KEYS, LOGIN, ghStatus, looksLikeGhHelper, parseHostsLogins } from './gh-accounts.mjs';

/**
 * Contract tests against the REAL gh CLI for every behaviour the hook (and the
 * fake gh in gh-accounts.test.mjs) relies on. Opt-in: set GH_HOOKS_E2E=1.
 * Token-dependent checks additionally need GH_E2E_TOKEN (CI passes the
 * workflow's GITHUB_TOKEN). Everything runs in a throwaway HOME and
 * GH_CONFIG_DIR so the caller's own gh/git auth is never touched, and no token
 * is ever printed.
 */
// Off Linux, gh uses the OS keyring, which is shared with the real user's gh
// regardless of HOME; only run there with an explicit acknowledgement.
const safeHost = process.platform === 'linux' || process.env.GH_HOOKS_E2E_ALLOW_KEYRING === '1';
const enabled = process.env.GH_HOOKS_E2E === '1' && safeHost;
const token = process.env.GH_E2E_TOKEN ?? '';
const withToken = enabled && token !== '';
const digest = (text) => createHash('sha256').update(text).digest('hex');

let root;
let env;
before(() => {
  if (!enabled) return;
  root = mkdtempSync(join(tmpdir(), 'alfe-gh-contract-'));
  mkdirSync(join(root, 'gh'));
  env = {
    PATH: process.env.PATH,
    HOME: root,
    GH_CONFIG_DIR: join(root, 'gh'),
    GIT_CONFIG_NOSYSTEM: '1',
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    NO_COLOR: '1',
  };
});
after(() => { if (root) rmSync(root, { recursive: true, force: true }); });

const gh = (args, input) => spawnSync('gh', args, { env, input: input ?? '', encoding: 'utf8', timeout: 30_000 });
const git = (args) => spawnSync('git', args, { env, encoding: 'utf8', timeout: 30_000 });
const hosts = () => readFileSync(join(root, 'gh', 'hosts.yml'), 'utf8');
const getAll = (key) => {
  const result = git(['config', '--global', '--get-all', key]);
  return result.status === 0 ? result.stdout.replace(/\n$/u, '').split('\n') : [];
};
let login;

test('gh is installed and supports multi-account (>= 2.40)', { skip: !enabled }, () => {
  const status = ghStatus();
  assert.equal(status.available, true);
  assert.equal(status.supported, true, `gh ${String(status.version)}`);
});

test('`gh auth token --user <missing>` exits 1 with "no oauth token found"', { skip: !enabled }, () => {
  const result = gh(['auth', 'token', '--hostname', 'github.com', '--user', 'alfe-contract-missing']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no oauth token found/iu);
  assert.equal(result.stdout, '');
});

test('`gh auth logout --user <missing>` is non-interactive and exits non-zero', { skip: !enabled }, () => {
  const result = gh(['auth', 'logout', '--hostname', 'github.com', '--user', 'alfe-contract-missing']);
  assert.notEqual(result.status, 0);
  assert.equal(result.signal, null);
});

test('login --with-token --insecure-storage stores the token and makes the account active', { skip: !withToken }, () => {
  // A second, pre-existing account proves login switches the active account.
  writeFileSync(join(root, 'gh', 'hosts.yml'), 'github.com:\n    users:\n        alfe-contract-other:\n            oauth_token: placeholder\n    git_protocol: https\n    oauth_token: placeholder\n    user: alfe-contract-other\n');
  const result = gh(['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--with-token', '--insecure-storage'], `${token}\n`);
  assert.equal(result.status, 0, result.stderr.split(token).join('[REDACTED]'));
  login = gh(['config', 'get', 'user', '--host', 'github.com']).stdout.trim();
  assert.match(login, LOGIN, 'the hook validator must accept the login gh reports');
  assert.notEqual(login, 'alfe-contract-other');
  const stored = gh(['auth', 'token', '--hostname', 'github.com', '--user', login]);
  assert.equal(stored.status, 0);
  assert.equal(digest(stored.stdout.trim()), digest(token));
  // The hook's hosts.yml parser must read what real gh wrote.
  assert.deepEqual(parseHostsLogins(hosts()).sort(), ['alfe-contract-other', login].sort());
});

test('`gh auth switch --user` changes the active account non-interactively', { skip: !withToken }, () => {
  assert.equal(gh(['auth', 'switch', '--hostname', 'github.com', '--user', 'alfe-contract-other']).status, 0);
  assert.equal(gh(['config', 'get', 'user', '--host', 'github.com']).stdout.trim(), 'alfe-contract-other');
  assert.equal(gh(['auth', 'switch', '--hostname', 'github.com', '--user', login]).status, 0);
  assert.equal(gh(['config', 'get', 'user', '--host', 'github.com']).stdout.trim(), login);
});

test('`gh auth setup-git --hostname github.com` writes exactly the keys/shape the hook owns', { skip: !withToken }, () => {
  for (const key of HELPER_KEYS) assert.deepEqual(getAll(key), []);
  const result = gh(['auth', 'setup-git', '--hostname', 'github.com']);
  assert.equal(result.status, 0, result.stderr);
  const values = Object.fromEntries(HELPER_KEYS.map((key) => [key, getAll(key)]));
  assert.ok(looksLikeGhHelper(values), JSON.stringify(values));
  // Nothing else in the global config: the hook only ever unsets these keys.
  const all = git(['config', '--global', '--list', '--name-only']).stdout.trim().split('\n').sort();
  assert.deepEqual(all, [...HELPER_KEYS, ...HELPER_KEYS].sort());
});

test('`gh auth logout --user` removes only that account, non-interactively', { skip: !withToken }, () => {
  const result = gh(['auth', 'logout', '--hostname', 'github.com', '--user', 'alfe-contract-other']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(parseHostsLogins(hosts()), [login]);
  assert.equal(gh(['auth', 'token', '--hostname', 'github.com', '--user', login]).status, 0);
  assert.equal(gh(['auth', 'logout', '--hostname', 'github.com', '--user', login]).status, 0);
  assert.deepEqual(parseHostsLogins(hosts()), []);
});
