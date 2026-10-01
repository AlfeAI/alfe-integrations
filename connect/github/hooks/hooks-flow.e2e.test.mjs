import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { HELPER_KEYS, looksLikeGhHelper, parseHostsLogins } from './gh-accounts.mjs';

/**
 * End-to-end run of the REAL hook scripts with the REAL gh, git and the
 * PUBLISHED @alfe.ai/config + @alfe.ai/agent-api-client, laid out exactly as
 * the daemon does: hooks under ~/.alfe/integrations/github/, shared packages
 * npm-installed into ~/.alfe/integrations/node_modules (see
 * packages/integrations/src/installer.ts ensureSharedPackages in the alfe
 * repo). The Alfe agent API is a local mock serving the getGithubAccounts()
 * wire shape; ALFE_API_KEY / ALFE_API_URL point resolveConfig() at it.
 *
 * Opt-in: GH_HOOKS_E2E=1 plus GH_E2E_TOKEN (a real token; CI uses the
 * workflow GITHUB_TOKEN) and GH_E2E_REPOSITORY (owner/repo the token can read,
 * used for `git ls-remote` through the credential helper). Runs in a throwaway
 * HOME. The token is never printed; outputs are asserted to not contain it.
 */
const token = process.env.GH_E2E_TOKEN ?? '';
const repository = process.env.GH_E2E_REPOSITORY ?? process.env.GITHUB_REPOSITORY ?? '';
// Off Linux the hook uses gh's OS keyring, which is shared with the real user's
// gh regardless of HOME (same service + login). Only run there when explicitly
// acknowledged, and never with a token for an account you use locally.
const safeHost = process.platform === 'linux' || process.env.GH_HOOKS_E2E_ALLOW_KEYRING === '1';
const enabled = process.env.GH_HOOKS_E2E === '1' && safeHost && token !== '' && repository !== '';
const source = dirname(dirname(fileURLToPath(import.meta.url)));
const API_KEY = 'alfe_e2e_key';

let root;
let home;
let hooks;
let server;
let apiUrl;
let login;
const state = { roster: [], fail: false, requests: 0 };

const hide = (text) => String(text).split(token).join('[REDACTED]');
function baseEnv() {
  return {
    PATH: process.env.PATH,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    NO_COLOR: '1',
  };
}

/** Run a hook the way the daemon does: interpreter by extension, 30 s kill, full env. */
function hook(file) {
  const command = file.endsWith('.mjs') ? process.execPath : 'bash';
  return new Promise((resolve) => {
    const child = spawn(command, [join(hooks, file)], {
      cwd: dirname(hooks),
      env: { ...baseEnv(), ALFE_API_KEY: API_KEY, ALFE_API_URL: apiUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const kill = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.on('close', (status, signal) => {
      clearTimeout(kill);
      resolve({ status, signal, stdout, stderr });
    });
  }).then((result) => {
    assert.ok(!result.stdout.includes(token) && !result.stderr.includes(token), `${file} printed the token`);
    return result;
  });
}

const gh = (args) => spawnSync('gh', args, { env: baseEnv(), encoding: 'utf8', timeout: 30_000 });
const git = (args) => spawnSync('git', args, { env: baseEnv(), encoding: 'utf8', timeout: 60_000 });
const hostsPath = () => join(home, '.config', 'gh', 'hosts.yml');
const ghLogins = () => (existsSync(hostsPath()) ? parseHostsLogins(readFileSync(hostsPath(), 'utf8')) : []);
const active = () => gh(['config', 'get', 'user', '--host', 'github.com']).stdout.trim();
const helper = () => Object.fromEntries(HELPER_KEYS.map((key) => {
  const result = git(['config', '--global', '--get-all', key]);
  return [key, result.status === 0 ? result.stdout.replace(/\n$/u, '').split('\n') : []];
}));
const ledger = () => JSON.parse(readFileSync(join(home, '.alfe', 'github-cli', 'owned-accounts.json'), 'utf8'));
const account = () => ({
  connectionId: 'con_e2e', accountIdentifier: login, displayName: null,
  connectedAt: '2026-10-01T00:00:00.000Z', accessToken: token, login, scopes: '',
});

before(async () => {
  if (!enabled) return;
  root = mkdtempSync(join(tmpdir(), 'alfe-github-hooks-e2e-'));
  home = join(root, 'home');
  const integrations = join(home, '.alfe', 'integrations');
  hooks = join(integrations, 'github', 'hooks');
  mkdirSync(integrations, { recursive: true });
  cpSync(source, join(integrations, 'github'), { recursive: true });
  // Shared packages exactly as the daemon installs them (published, "latest").
  writeFileSync(join(integrations, 'package.json'), `${JSON.stringify({
    name: 'alfe-integrations-root', private: true, type: 'module',
    dependencies: { '@alfe.ai/config': 'latest', '@alfe.ai/agent-api-client': 'latest' },
  }, null, 2)}\n`);
  const install = spawnSync('npm', ['install', '--production', '--no-audit', '--no-fund'], { cwd: integrations, encoding: 'utf8', timeout: 180_000 });
  assert.equal(install.status, 0, install.stderr);

  // Which login does gh resolve for this token? (An Actions GITHUB_TOKEN is an
  // installation token: gh reports `github-actions[bot]`.)
  const probeDir = join(root, 'probe-gh');
  mkdirSync(probeDir);
  const probe = spawnSync('gh', ['api', 'graphql', '-f', 'query=query{viewer{login}}', '--jq', '.data.viewer.login'], {
    env: { PATH: process.env.PATH, HOME: root, GH_CONFIG_DIR: probeDir, GH_TOKEN: token, GH_PROMPT_DISABLED: '1' },
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(probe.status, 0, `gh could not resolve the token's login: ${hide(probe.stderr)}`);
  login = probe.stdout.trim();
  console.log(`e2e token resolves to GitHub login ${login}`);

  server = createServer((request, response) => {
    state.requests += 1;
    const ok = request.method === 'GET' && request.url === '/agent/connect/github/accounts'
      && request.headers.authorization === `Bearer ${API_KEY}`;
    if (!ok) { response.writeHead(404).end(); return; }
    if (state.fail) { response.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"unavailable"}'); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: { provider: 'github', accounts: state.roster } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  apiUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (root) rmSync(root, { recursive: true, force: true });
});

test('real hook lifecycle: activate, git through the helper, prune, uninstall', { skip: !enabled && 'set GH_HOOKS_E2E=1, GH_E2E_TOKEN and GH_E2E_REPOSITORY' }, async (t) => {
  await t.test('health with no ledger is healthy', async () => {
    const result = await hook('health.sh');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /No Alfe-managed GitHub CLI accounts/u);
  });

  // A user's own account (placeholder token) that is active before the hook runs.
  mkdirSync(dirname(hostsPath()), { recursive: true });
  writeFileSync(hostsPath(), 'github.com:\n    users:\n        alfe-e2e-human:\n            oauth_token: placeholder\n    git_protocol: https\n    oauth_token: placeholder\n    user: alfe-e2e-human\n');

  await t.test('activation logs the roster account in, keeps the user active, configures git', async () => {
    state.roster = [account()];
    const result = await hook('post_activate.mjs');
    assert.equal(result.status, 0, hide(result.stdout + result.stderr));
    assert.match(result.stdout, /1 logged in/u);
    assert.deepEqual(ghLogins().sort(), ['alfe-e2e-human', login].sort());
    assert.equal(active(), 'alfe-e2e-human');
    assert.deepEqual(ledger().accounts.map((entry) => entry.login), [login]);
    assert.ok(looksLikeGhHelper(helper()), JSON.stringify(helper()));
  });

  await t.test('health is healthy with the owned account present', async () => {
    const result = await hook('health.sh');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /credentials for 1 Alfe-managed/u);
  });

  await t.test('after `gh auth switch`, git authenticates through the helper', () => {
    assert.equal(gh(['auth', 'switch', '--hostname', 'github.com', '--user', login]).status, 0);
    const status = gh(['auth', 'status', '--hostname', 'github.com', '--active']);
    assert.equal(status.status, 0, hide(status.stderr));
    // Proof git resolves THIS token through the helper (the repository may be
    // public, so ls-remote alone would not prove authentication).
    const fill = spawnSync('git', ['credential', 'fill'], {
      env: baseEnv(), encoding: 'utf8', timeout: 30_000,
      input: `protocol=https\nhost=github.com\npath=${repository}.git\n\n`,
    });
    assert.equal(fill.status, 0, hide(fill.stderr));
    const password = /^password=(.*)$/mu.exec(fill.stdout)?.[1];
    assert.ok(password === token, 'git credential helper did not return the roster token');
    const remote = git(['ls-remote', '--heads', `https://github.com/${repository}`]);
    assert.equal(remote.status, 0, hide(remote.stderr));
    assert.ok(remote.stdout.length > 0);
  });

  await t.test('re-activation with the same roster changes nothing', async () => {
    const result = await hook('post_activate.mjs');
    assert.equal(result.status, 0, hide(result.stderr));
    assert.match(result.stdout, /0 logged in, 1 unchanged/u);
    assert.equal(active(), login);
  });

  await t.test('roster fetch failure exits 1 and prunes nothing', async () => {
    state.fail = true;
    const result = await hook('post_activate.mjs');
    state.fail = false;
    assert.equal(result.status, 1);
    assert.ok(ghLogins().includes(login));
  });

  await t.test('empty roster logs out only the owned account', async () => {
    state.roster = [];
    const result = await hook('post_activate.mjs');
    assert.equal(result.status, 0, hide(result.stderr));
    assert.match(result.stdout, /1 removed/u);
    assert.deepEqual(ghLogins(), ['alfe-e2e-human']);
    assert.deepEqual(ledger().accounts, []);
    // The helper is the hook's until uninstall.
    assert.ok(looksLikeGhHelper(helper()));
  });

  await t.test('uninstall removes the owned helper and keeps the user account', async () => {
    const result = await hook('post_uninstall.mjs');
    assert.equal(result.status, 0, result.stderr);
    for (const values of Object.values(helper())) assert.deepEqual(values, []);
    assert.deepEqual(ghLogins(), ['alfe-e2e-human']);
    assert.deepEqual(ledger(), { version: 1, accounts: [], gitHelper: null });
  });

  assert.ok(state.requests >= 4);
});
