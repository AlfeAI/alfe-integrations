import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { BLOCK_BEGIN, BLOCK_END } from './aws-profiles.mjs';

const hooksDir = dirname(fileURLToPath(import.meta.url));
const roots = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

/**
 * Fake aws: only `--version`. Every other call is logged and fails, so the
 * test proves health is local (no `sts get-caller-identity`).
 */
function setup({ version = '2.31.5', installed = true, config, ledger, script = 'health.sh', uname }) {
  const root = mkdtempSync(join(tmpdir(), 'alfe-aws-health-'));
  roots.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const tool of ['bash', 'node', 'sed', 'sort', 'head', 'printf', 'id', 'dirname']) {
    const found = spawnSync('/usr/bin/env', ['which', tool], { encoding: 'utf8' }).stdout.trim();
    if (found) writeFileSync(join(bin, tool), `#!/bin/sh\nexec "${found}" "$@"\n`, { mode: 0o755 });
  }
  writeFileSync(join(bin, 'uname'), `#!/bin/sh\n${uname ? `echo "${uname}"` : 'exec /usr/bin/uname "$@"'}\n`, { mode: 0o755 });
  if (installed) {
    writeFileSync(join(bin, 'aws'), `#!/bin/sh
echo "$*" >> "${join(root, 'calls.log')}"
if [ "$1" = "--version" ]; then ${version === 'broken' ? 'echo "Segmentation fault" >&2; exit 139' : `echo "aws-cli/${version} Python/3.13.7 Linux/6.8.0 exe/x86_64.ubuntu.24"; exit 0`}; fi
exit 9
`, { mode: 0o755 });
  }
  if (config !== undefined) {
    mkdirSync(join(root, '.aws'));
    writeFileSync(join(root, '.aws', 'config'), config);
  }
  if (ledger !== undefined) {
    mkdirSync(join(root, '.alfe', 'aws-cli'), { recursive: true });
    writeFileSync(join(root, '.alfe', 'aws-cli', 'owned-profiles.json'), typeof ledger === 'string' ? ledger : JSON.stringify(ledger));
  }
  const result = spawnSync(join(bin, 'bash'), [join(hooksDir, script)], { encoding: 'utf8', env: { HOME: root, PATH: bin } });
  let calls = '';
  try { calls = readFileSync(join(root, 'calls.log'), 'utf8'); } catch { /* aws never ran */ }
  return { ...result, calls, bin };
}

const block = (alfe, ...profiles) => `${BLOCK_BEGIN}\n${profiles.map((p) => `[profile ${p}]\nregion = us-east-1\ncredential_process = ${alfe} aws credentials --connection con_one --profile ${p}`).join('\n\n')}\n${BLOCK_END}\n`;
const owned = (...profiles) => ({ version: 1, configPath: '/x', profiles: profiles.map((profile) => ({ profile, connectionId: 'con_one' })) });

test('missing or broken aws fails health (the CLI is the integration)', () => {
  for (const options of [{ installed: false }, { version: 'broken' }]) {
    const result = setup(options);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /ERROR: /u);
  }
});

test('an old aws warns but stays healthy', () => {
  const result = setup({ version: '2.9.0' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /WARNING: AWS CLI 2\.9\.0 is older than 2\.15\.0/u);
});

test('no config or no block is healthy; health never calls AWS', () => {
  for (const config of [undefined, '[default]\nregion = us-east-1\n']) {
    const result = setup({ config });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /No Alfe-managed AWS profiles|no Alfe-managed AWS profiles/u);
    assert.equal(result.calls.trim(), '--version');
  }
});

test('a well-formed block owned by the ledger is healthy and names its profiles', () => {
  // Any existing executable stands in for alfe (a missing one only warns).
  const result = setup({ config: `[default]\n${block(process.execPath, 'a', 'b')}`, ledger: owned('a', 'b') });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /2 Alfe-managed AWS profile\(s\): a, b/u);
  assert.doesNotMatch(result.stdout, /WARNING/u);
});

test('a malformed or hand-edited block, or an unreadable ledger, fails health', () => {
  for (const config of [`${BLOCK_BEGIN}\n[profile a]\n`, block('/usr/local/bin/alfe', 'a').replace('region = us-east-1', 'region = us-east-1\naws_secret_access_key = x')]) {
    const result = setup({ config, ledger: owned('a') });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /ERROR: /u);
  }
  const ledger = setup({ ledger: '{' });
  assert.equal(ledger.status, 1);
  assert.match(ledger.stdout, /ownership record is unreadable/u);
});

test('post-install.sh is best effort: off Linux, with a current aws, or with a broken aws, it exits 0', () => {
  const current = setup({ script: 'post-install.sh' });
  assert.equal(current.status, 0, current.stdout + current.stderr);
  assert.match(current.stdout, /AWS CLI version: 2\.31\.5/u);

  const darwin = setup({ installed: false, script: 'post-install.sh', uname: 'Darwin' });
  assert.equal(darwin.status, 0, darwin.stdout + darwin.stderr);
  assert.match(darwin.stdout, /WARNING: Automatic AWS CLI install is only supported on Linux/u);

  const broken = setup({ version: 'broken', script: 'post-install.sh', uname: 'Darwin' });
  assert.equal(broken.status, 0, broken.stdout + broken.stderr);
  assert.match(broken.stdout, /AWS CLI unknown version is older than 2\.15\.0/u);
  assert.match(broken.stdout, /WARNING: /u);

  const v1 = setup({ version: '1.33.0', script: 'post-install.sh', uname: 'Darwin' });
  assert.match(v1.stdout, /AWS CLI 1\.33\.0 is older than 2\.15\.0; installing AWS CLI v2/u);
  assert.equal(v1.status, 0);
});
