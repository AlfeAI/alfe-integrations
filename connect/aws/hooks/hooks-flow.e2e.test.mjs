import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { BLOCK_BEGIN } from './aws-profiles.mjs';

/**
 * End-to-end run of the REAL hook scripts with the REAL AWS CLI, laid out as
 * the daemon does: hooks under ~/.alfe/integrations/aws/, shared packages
 * npm-installed into ~/.alfe/integrations/node_modules. The Alfe agent API is
 * a local mock serving the route-5 roster; ALFE_API_KEY / ALFE_API_URL point
 * resolveConfig() at it. A stub `alfe` prints static fake credentials for
 * `alfe aws credentials`, so `aws configure export-credentials` proves the
 * written profiles reach credential_process without any network call to AWS.
 *
 * Opt-in: AWS_HOOKS_E2E=1 and an AWS CLI v2 on PATH (CI installs it with
 * post-install.sh first). Runs in a throwaway HOME.
 */
const enabled = process.env.AWS_HOOKS_E2E === '1';
const source = dirname(dirname(fileURLToPath(import.meta.url)));
const API_KEY = 'alfe_e2e_key';
const FAKE = {
  Version: 1,
  AccessKeyId: 'ASIAE2ESTUBKEY000000',
  SecretAccessKey: 'e2e-stub-secret-not-real-0000000000000000',
  SessionToken: 'e2e-stub-session-token',
  Expiration: '2099-01-01T00:00:00Z',
};

let root;
let home;
let hooks;
let stubBin;
let server;
let apiUrl;
const state = { roster: [], requests: 0 };

const profile = (name, extra = {}) => ({
  profile: name, roleArn: `arn:aws:iam::123456789012:role/${name}`, accountId: '123456789012', region: 'us-east-1',
  label: null, connectionId: 'con_e2e', accountIdentifier: `${name}#abc`, displayName: name, connectedAt: '2026-10-01T00:00:00.000Z',
  ...extra,
});

function baseEnv() {
  // Built from scratch: no ambient AWS_* variable may redirect or override the profiles.
  return { PATH: `${stubBin}:${process.env.PATH}`, HOME: home, AWS_PAGER: '', AWS_EC2_METADATA_DISABLED: 'true' };
}

/** Run a hook the way the daemon does: interpreter by extension, 30 s kill. */
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
    child.on('close', (status, signal) => { clearTimeout(kill); resolve({ status, signal, stdout, stderr }); });
  });
}

const aws = (args) => spawnSync('aws', args, { env: baseEnv(), encoding: 'utf8', timeout: 60_000 });
const listProfiles = () => {
  const result = aws(['configure', 'list-profiles']);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean).sort();
};
const config = () => readFileSync(join(home, '.aws', 'config'), 'utf8');

before(async () => {
  if (!enabled) return;
  root = realpathSync(mkdtempSync(join(tmpdir(), 'alfe-aws-hooks-e2e-')));
  home = join(root, 'home');
  const integrations = join(home, '.alfe', 'integrations');
  hooks = join(integrations, 'aws', 'hooks');
  mkdirSync(integrations, { recursive: true });
  cpSync(source, join(integrations, 'aws'), { recursive: true });

  // Shared packages exactly as the daemon installs them (published, "latest").
  writeFileSync(join(integrations, 'package.json'), `${JSON.stringify({
    name: 'alfe-integrations-root', private: true, type: 'module',
    dependencies: { '@alfe.ai/config': 'latest', '@alfe.ai/agent-api-client': 'latest' },
  }, null, 2)}\n`);
  const install = spawnSync('npm', ['install', '--production', '--no-audit', '--no-fund'], { cwd: integrations, encoding: 'utf8', timeout: 180_000 });
  assert.equal(install.status, 0, install.stderr);
  // Until the client release carrying getAwsProfiles() is published, stand in
  // a contract stub that calls route 5 the same way (Bearer key, {data} envelope).
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e',
    'const { AgentApiClient } = await import("@alfe.ai/agent-api-client"); process.stdout.write(typeof AgentApiClient.prototype.getAwsProfiles);'],
  { cwd: integrations, encoding: 'utf8' });
  if (probe.stdout.trim() !== 'function') {
    console.log('# published @alfe.ai/agent-api-client predates getAwsProfiles(); using a route-5 contract stub');
    const dir = join(integrations, 'node_modules', '@alfe.ai', 'agent-api-client');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@alfe.ai/agent-api-client', type: 'module', main: 'index.js' }));
    writeFileSync(join(dir, 'index.js'), `export class AgentApiClient {
  constructor({ apiKey, apiUrl }) { this.apiKey = apiKey; this.apiUrl = apiUrl; }
  async getAwsProfiles() {
    const response = await fetch(new URL('/agent/connect/aws/accounts', this.apiUrl), { headers: { authorization: 'Bearer ' + this.apiKey } });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return (await response.json()).data.accounts;
  }
}\n`);
  }

  // Stub alfe: `aws --help` succeeds; `aws credentials` validates its argv and
  // prints static fake credentials (route-6 body), logging each call.
  stubBin = join(root, 'bin');
  mkdirSync(stubBin);
  writeFileSync(join(stubBin, 'alfe'), `#!/bin/sh
if [ "$1 $2" = "aws --help" ]; then echo "Usage: alfe aws <command>"; exit 0; fi
if [ "$1 $2 $3" = "aws credentials --connection" ] && [ "$5" = "--profile" ] && [ $# -eq 6 ]; then
  echo "$4 $6" >> "${join(root, 'credential-calls.log')}"
  printf '%s\\n' '${JSON.stringify(FAKE)}'
  exit 0
fi
echo "unexpected alfe invocation: $*" >&2
exit 1
`, { mode: 0o755 });

  server = createServer((request, response) => {
    state.requests += 1;
    const ok = request.method === 'GET' && request.url === '/agent/connect/aws/accounts'
      && request.headers.authorization === `Bearer ${API_KEY}`;
    if (!ok) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: { provider: 'aws', accounts: state.roster } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  apiUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (root) rmSync(root, { recursive: true, force: true });
});

test('real hook lifecycle: activate, credential_process, prune, uninstall', { skip: !enabled && 'set AWS_HOOKS_E2E=1 (needs AWS CLI v2 on PATH)' }, async (t) => {
  const userConfig = '[default]\nregion = ap-southeast-2\n\n[profile mine]\nregion = eu-west-1\n';

  await t.test('health with no config is healthy', async () => {
    const result = await hook('health.sh');
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });

  await t.test('post_activate writes one profile per identity next to the user profiles', async () => {
    mkdirSync(join(home, '.aws'), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, '.aws', 'config'), userConfig);
    state.roster = [
      profile('prod-admin'),
      profile('direct', { roleArn: null, region: 'us-west-2' }),
      profile('mine'), // collides with the user's own profile: skipped
    ];
    const result = await hook('post_activate.mjs');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /WARNING: AWS profile "mine" already exists outside the alfe managed block/u);
    assert.ok(config().startsWith(userConfig));
    assert.ok(config().includes(BLOCK_BEGIN));
    assert.deepEqual(listProfiles(), ['default', 'direct', 'mine', 'prod-admin']);
    assert.equal(aws(['configure', 'get', 'region', '--profile', 'direct']).stdout.trim(), 'us-west-2');
  });

  await t.test('aws resolves credentials through credential_process (stub alfe, no network)', async () => {
    const result = aws(['configure', 'export-credentials', '--profile', 'prod-admin', '--format', 'process']);
    assert.equal(result.status, 0, result.stderr);
    const exported = JSON.parse(result.stdout);
    assert.equal(exported.AccessKeyId, FAKE.AccessKeyId);
    assert.equal(exported.SecretAccessKey, FAKE.SecretAccessKey);
    assert.equal(exported.SessionToken, FAKE.SessionToken);
    assert.match(readFileSync(join(root, 'credential-calls.log'), 'utf8'), /^con_e2e prod-admin$/mu);
    // The user's own profile is untouched (no credential_process).
    assert.equal(aws(['configure', 'get', 'credential_process', '--profile', 'mine']).status, 1);
  });

  await t.test('health is healthy with the managed block', async () => {
    const result = await hook('health.sh');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /2 Alfe-managed AWS profile\(s\): prod-admin, direct/u);
  });

  await t.test('a re-run with a smaller roster prunes the removed profile and its cache', async () => {
    const cache = join(home, '.alfe', 'aws-cli', 'cache');
    mkdirSync(cache, { recursive: true, mode: 0o700 });
    const { cacheFileName } = await import('./aws-profiles.mjs');
    writeFileSync(join(cache, cacheFileName('con_e2e', 'direct')), '{}', { mode: 0o600 });
    state.roster = [profile('prod-admin')];
    const result = await hook('post_activate.mjs');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(listProfiles(), ['default', 'mine', 'prod-admin']);
    assert.equal(existsSync(join(cache, cacheFileName('con_e2e', 'direct'))), false);
  });

  await t.test('post_uninstall removes only Alfe contributions and keeps the CLI', async () => {
    const result = await hook('post_uninstall.mjs');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(config(), userConfig);
    assert.deepEqual(listProfiles(), ['default', 'mine']);
    assert.equal(existsSync(join(home, '.alfe', 'aws-cli')), false);
    assert.equal(aws(['--version']).status, 0);
  });
});
