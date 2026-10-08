import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { BLOCK_BEGIN } from './aws-profiles.mjs';

// Exit-code contract of the real hook entrypoints, run as the daemon would
// (node + shared @alfe.ai packages resolved from an ancestor node_modules),
// with stubbed packages and a fake `alfe` on PATH.
const here = dirname(fileURLToPath(import.meta.url));
const roots = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

function pkg(root, name, source) {
  const dir = join(root, 'node_modules', '@alfe.ai', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `@alfe.ai/${name}`, type: 'module', main: 'index.js' }));
  writeFileSync(join(dir, 'index.js'), source);
}

const profile = (name, extra = {}) => ({
  profile: name, roleArn: `arn:aws:iam::123456789012:role/${name}`, accountId: '123456789012', region: 'us-east-1',
  label: null, connectionId: 'con_one', accountIdentifier: `${name}#abc`, displayName: name, connectedAt: '2026-10-01T00:00:00.000Z',
  ...extra,
});

const fakeAlfe = (cli) => `#!/bin/sh
if [ "$1" = "aws" ]; then ${cli === 'new' ? 'echo "Usage: alfe aws"; exit 0' : 'echo "error: unknown command \'aws\'" >&2; exit 1'}; fi
exit 1
`;

/**
 * @param {object} options
 * @param {'new'|'old'|'missing'} [options.cli] fake alfe: supports `alfe aws`, predates it, or absent.
 * @param {string} [options.binName] PATH directory name (a space makes the alfe path unusable unquoted).
 * @param {boolean} [options.legacyClient] agent-api-client without getAwsProfiles().
 */
function setup({ roster = [], cli = 'new', binName = 'bin', fetchFails = false, fetchHangs = false, legacyClient = false, config } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'alfe-aws-hook-')));
  roots.push(root);
  const hooks = join(root, 'integration', 'hooks');
  mkdirSync(hooks, { recursive: true });
  for (const file of ['aws-profiles.mjs', 'post_activate.mjs', 'post_uninstall.mjs']) copyFileSync(join(here, file), join(hooks, file));
  pkg(root, 'config', 'export const resolveConfig = () => ({ apiKey: "k", apiUrl: "http://127.0.0.1:9" });\n');
  pkg(root, 'agent-api-client', legacyClient ? 'export class AgentApiClient {}\n' : `export class AgentApiClient {
  async getAwsProfiles() {
    if (process.env.FAKE_FETCH_FAILS) throw new Error('HTTP 503');
    if (process.env.FAKE_FETCH_HANGS) {
      setInterval(() => {}, 1000); // an open socket keeping the loop alive
      return new Promise(() => {});
    }
    return JSON.parse(process.env.FAKE_ROSTER);
  }
}\n`);
  const bin = join(root, binName);
  mkdirSync(bin);
  const installCli = (kind) => writeFileSync(join(bin, 'alfe'), fakeAlfe(kind), { mode: 0o755 });
  if (cli !== 'missing') installCli(cli);
  const home = join(root, 'home');
  mkdirSync(home);
  if (config !== undefined) {
    mkdirSync(join(home, '.aws'));
    writeFileSync(join(home, '.aws', 'config'), config);
  }
  const run = (hook) => spawnSync(process.execPath, [join(hooks, hook)], {
    encoding: 'utf8',
    timeout: 25_000,
    env: {
      HOME: home,
      PATH: bin,
      FAKE_ROSTER: JSON.stringify(roster),
      ...(fetchFails ? { FAKE_FETCH_FAILS: '1' } : {}),
      ...(fetchHangs ? { FAKE_FETCH_HANGS: '1' } : {}),
    },
  });
  return { root, home, bin, run, installCli, configText: () => readFileSync(join(home, '.aws', 'config'), 'utf8') };
}

test('writes the managed block with the ABSOLUTE alfe path and exits 0', () => {
  const env = setup({ roster: [profile('prod-admin'), profile('direct', { roleArn: null })] });
  const result = env.run('post_activate.mjs');
  assert.equal(result.status, 0, result.stderr);
  const text = env.configText();
  assert.ok(text.startsWith(BLOCK_BEGIN));
  assert.match(text, new RegExp(`credential_process = ${join(env.bin, 'alfe').replace(/[.+]/gu, '\\$&')} aws credentials --connection con_one --profile prod-admin\\n`, 'u'));
  assert.doesNotMatch(text, /\[default\]/u);
  assert.match(result.stdout, /Configured 2 AWS profile\(s\)/u);
});

test('a host that cannot run `alfe aws` exits 1 with an ERROR, writes NO block and never fetches', () => {
  for (const options of [{ cli: 'old' }, { cli: 'missing' }, { binName: 'my bin' }]) {
    const env = setup({ roster: [profile('a')], fetchFails: true, ...options });
    const result = env.run('post_activate.mjs');
    const label = JSON.stringify(options);
    assert.equal(result.status, 1, `${label}: ${result.stderr}`);
    assert.match(result.stderr, /ERROR: .*AWS profiles were not configured/u, label);
    // The fetch would fail with "roster unavailable": the probe runs first.
    assert.doesNotMatch(result.stderr, /roster unavailable/u, label);
    assert.equal(existsSync(join(env.home, '.aws')), false, label);
    assert.equal(existsSync(join(env.home, '.alfe')), false, label);
  }
});

test('the re-activation after a CLI upgrade writes the profiles (the rollout recovery path)', () => {
  // Activation before the CLI upgrade fails; the daemon keeps the integration
  // in `error` and re-runs post_activate on a later DESIRED_STATE.
  const env = setup({ roster: [profile('prod-admin')], cli: 'old' });
  assert.equal(env.run('post_activate.mjs').status, 1);
  assert.equal(existsSync(join(env.home, '.aws')), false);
  env.installCli('new');
  const result = env.run('post_activate.mjs');
  assert.equal(result.status, 0, result.stderr);
  assert.match(env.configText(), /\[profile prod-admin\]\n/u);
});

test('an agent-api-client without getAwsProfiles() exits 1 with an ERROR and writes nothing', () => {
  const env = setup({ legacyClient: true, roster: [profile('a')] });
  const result = env.run('post_activate.mjs');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /ERROR: .*no getAwsProfiles/u);
  assert.equal(existsSync(join(env.home, '.aws')), false);
});

test('roster fetch failure or invalid roster exits 1 WITHOUT mutating anything', () => {
  const existing = `[default]\nregion = us-west-2\n${BLOCK_BEGIN}\n[profile kept]\nregion = us-east-1\ncredential_process = /usr/local/bin/alfe aws credentials --connection con_one --profile kept\n# <<< alfe managed <<<\n`;
  const fails = setup({ fetchFails: true, config: existing });
  assert.equal(fails.run('post_activate.mjs').status, 1);
  assert.equal(fails.configText(), existing);

  const invalid = setup({ roster: [profile('ok'), profile('bad', { region: 'us-east-1\n[default]' })], config: existing });
  const result = invalid.run('post_activate.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /roster unavailable or invalid: AWS profile entry contains a line break/u);
  assert.equal(invalid.configText(), existing);
  assert.equal(existsSync(join(invalid.home, '.alfe', 'aws-cli', 'owned-profiles.json')), false);
});

test('a local config problem (malformed block) is a WARNING with exit 0 and leaves the file alone', () => {
  const broken = `[default]\n${BLOCK_BEGIN}\n`;
  const env = setup({ roster: [profile('a')], config: broken });
  const result = env.run('post_activate.mjs');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /WARNING: AWS profiles were not configured: .*malformed/u);
  assert.equal(env.configText(), broken);
});

test('a hanging roster fetch is bounded: exits 1 well inside the daemon 30 s kill', () => {
  const startedAt = Date.now();
  const result = setup({ fetchHangs: true }).run('post_activate.mjs');
  const elapsed = Date.now() - startedAt;
  assert.equal(result.status, 1, `${String(result.signal)} ${result.stderr}`);
  assert.match(result.stderr, /roster unavailable/u);
  assert.ok(elapsed < 15_000, `took ${elapsed} ms`);
});

test('post_uninstall removes the block and exits 0, even when cleanup cannot run', () => {
  const env = setup({ roster: [profile('a')], config: '[default]\n' });
  assert.equal(env.run('post_activate.mjs').status, 0);
  const result = env.run('post_uninstall.mjs');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(env.configText(), '[default]\n');
  assert.equal(existsSync(join(env.home, '.alfe', 'aws-cli')), false);

  const broken = setup({ config: `${BLOCK_BEGIN}\n` });
  const failed = broken.run('post_uninstall.mjs');
  assert.equal(failed.status, 0);
  assert.match(failed.stderr, /WARNING: AWS profile cleanup did not complete/u);
});
