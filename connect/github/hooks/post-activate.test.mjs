import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';

// Exit-code contract of the real hook entrypoints, run as the daemon would
// (node + shared @alfe.ai packages resolved from an ancestor node_modules),
// with stubbed packages and a fake `gh` on PATH.
const here = dirname(fileURLToPath(import.meta.url));
const roots = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

const TOKEN = 'gho_entrypointSecretToken00000000000';

function pkg(root, name, source) {
  const dir = join(root, 'node_modules', '@alfe.ai', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `@alfe.ai/${name}`, type: 'module', main: 'index.js' }));
  writeFileSync(join(dir, 'index.js'), source);
}

function run(hook, { roster, fetchFails = false, ghLoginFails = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'alfe-github-hook-'));
  roots.push(root);
  const hooks = join(root, 'integration', 'hooks');
  mkdirSync(hooks, { recursive: true });
  for (const file of ['gh-accounts.mjs', 'post_activate.mjs', 'post_uninstall.mjs']) copyFileSync(join(here, file), join(hooks, file));
  pkg(root, 'config', 'export const resolveConfig = () => ({ apiKey: "k", apiUrl: "http://127.0.0.1:9" });\n');
  pkg(root, 'agent-api-client', `export class AgentApiClient {
  async getGithubAccounts() {
    if (process.env.FAKE_FETCH_FAILS) throw new Error('HTTP 503');
    return JSON.parse(process.env.FAKE_ROSTER);
  }
}\n`);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  // gh that is installed and new enough, holds no accounts, and (optionally)
  // fails every login with stderr echoing stdin.
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
case "$1 $2" in
  "--version ") echo "gh version 2.74.2 (2026-01-01)"; exit 0 ;;
  "auth token") echo "no oauth token found for github.com account x" >&2; exit 1 ;;
  "config get") echo 'could not find key "user"' >&2; exit 1 ;;
  "auth login") if [ -n "$FAKE_GH_LOGIN_FAILS" ]; then echo "bad credentials: $(cat)" >&2; exit 1; fi; exit 0 ;;
esac
exit 1
`, { mode: 0o755 });
  const home = join(root, 'home');
  mkdirSync(home);
  return spawnSync(process.execPath, [join(hooks, hook)], {
    encoding: 'utf8',
    env: {
      HOME: home,
      PATH: bin,
      FAKE_ROSTER: JSON.stringify(roster ?? { accounts: [] }),
      ...(fetchFails ? { FAKE_FETCH_FAILS: '1' } : {}),
      ...(ghLoginFails ? { FAKE_GH_LOGIN_FAILS: '1' } : {}),
    },
  });
}

const roster = { accounts: [{ login: 'primary', accessToken: TOKEN }] };

test('roster fetch failure or invalid roster exits 1', () => {
  assert.equal(run('post_activate.mjs', { fetchFails: true }).status, 1);
  const invalid = run('post_activate.mjs', { roster: { accounts: [{ login: '../x', accessToken: TOKEN }] } });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /roster unavailable or invalid: Invalid GitHub account login/u);
});

test('gh-side failure warns (redacted) and exits 0', () => {
  const result = run('post_activate.mjs', { roster, ghLoginFails: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /WARNING: .*auth login failed/u);
  assert.ok(!(result.stdout + result.stderr).includes(TOKEN));
});

test('post_uninstall exits 0 even when cleanup cannot run', () => {
  const result = run('post_uninstall.mjs');
  assert.equal(result.status, 0, result.stderr);
});
