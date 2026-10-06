import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';

const hooksDir = dirname(fileURLToPath(import.meta.url));
const roots = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

const SECRET = 'gho_healthSecretToken000000000000000';

/**
 * Fake gh: `--version`, and `auth token --user <login>` for logins listed in
 * $FAKE_GH_USERS. Every other call (including anything networked such as
 * `auth status`) is logged and fails, so the test proves the check is local.
 */
function setup({ version = '2.74.2', users = [], ledger, installed = true, script = 'health.sh' }) {
  const root = mkdtempSync(join(tmpdir(), 'alfe-github-health-'));
  roots.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const tool of ['bash', 'node', 'sed', 'sort', 'head', 'printf', 'uname', 'id']) {
    const found = spawnSync('/usr/bin/env', ['which', tool], { encoding: 'utf8' }).stdout.trim();
    if (found) writeFileSync(join(bin, tool), `#!/bin/sh\nexec "${found}" "$@"\n`, { mode: 0o755 });
  }
  if (installed) {
    writeFileSync(join(bin, 'gh'), `#!/bin/sh
echo "$*" >> "${join(root, 'calls.log')}"
if [ "$1" = "--version" ]; then ${version === 'broken' ? 'echo "segfault" >&2; exit 3' : `echo "gh version ${version} (2026-01-01)"; exit 0`}; fi
if [ "$1 $2" = "auth token" ]; then
  for user in $FAKE_GH_USERS; do [ "$user" = "$6" ] && { echo "${SECRET}"; exit 0; }; done
  echo "no oauth token found for github.com account $6" >&2; exit 1
fi
exit 9
`, { mode: 0o755 });
  }
  if (ledger !== undefined) {
    mkdirSync(join(root, '.alfe', 'github-cli'), { recursive: true });
    writeFileSync(join(root, '.alfe', 'github-cli', 'owned-accounts.json'), typeof ledger === 'string' ? ledger : JSON.stringify(ledger));
  }
  const result = spawnSync(join(bin, 'bash'), [join(hooksDir, script)], {
    encoding: 'utf8',
    env: { HOME: root, PATH: bin, FAKE_GH_USERS: users.join(' '), GH_TOKEN: 'ambient' },
  });
  let calls = '';
  try { calls = readFileSync(join(root, 'calls.log'), 'utf8'); } catch { /* gh never ran */ }
  return { ...result, calls };
}

const owned = (...logins) => ({ version: 1, accounts: logins.map((login) => ({ login, sha256: 'a'.repeat(64) })), gitHelper: null });

test('missing or pre-multi-account gh warns but stays healthy', () => {
  for (const options of [{ installed: false }, { version: '2.39.0' }]) {
    const result = setup({ ...options, ledger: owned('primary') });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /WARNING/u);
  }
});

test('no ledger or no owned accounts is healthy without checking accounts', () => {
  for (const ledger of [undefined, owned()]) {
    const result = setup({ ledger });
    assert.equal(result.status, 0, result.stdout);
    assert.doesNotMatch(result.calls, /auth token/u);
  }
});

test('owned accounts present locally are healthy; no network command and no token output', () => {
  const result = setup({ ledger: owned('primary', 'org-bot'), users: ['primary', 'org-bot', 'human'] });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /2 Alfe-managed/u);
  assert.doesNotMatch(result.calls, /auth status|api/u);
  assert.ok(!(result.stdout + result.stderr).includes(SECRET));
});

test('an owned account missing from gh (user logout) warns, names it, and stays healthy', () => {
  const result = setup({ ledger: owned('primary', 'org-bot'), users: ['primary'] });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /WARNING: .*missing from gh: org-bot/u);
  assert.ok(!(result.stdout + result.stderr).includes(SECRET));
});

test('an unreadable or malformed ledger fails health', () => {
  for (const ledger of ['{', JSON.stringify({ version: 1, accounts: [{ login: '$(evil)' }] })]) {
    const result = setup({ ledger });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /ledger is unreadable/u);
  }
});

test('a gh whose --version fails does not abort health or post-install (always exit 0)', () => {
  const health = setup({ version: 'broken', ledger: owned('primary'), users: ['primary'] });
  assert.equal(health.status, 0, health.stdout + health.stderr);
  assert.match(health.stdout, /WARNING: gh unknown version/u);
  // post-install treats it as too old and tries to upgrade; off a root apt host
  // that is a WARNING with exit 0, never a script abort.
  const install = setup({ version: 'broken', script: 'post-install.sh' });
  assert.equal(install.status, 0, install.stdout + install.stderr);
  assert.match(install.stdout, /gh unknown version is older than 2\.40\.0/u);
  assert.match(install.stdout, /WARNING: /u);
});
