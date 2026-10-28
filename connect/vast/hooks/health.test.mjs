import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';

const hooksDir = dirname(fileURLToPath(import.meta.url));
const roots = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

/**
 * Runs health.sh with a PATH holding only bash, a fake `alfe` and (optionally)
 * fake OpenSSH tools. The fake alfe logs every call, so the test proves health
 * is local only. It models commander 13 (the CLI's parser): `alfe gpu --help`
 * on a CLI WITHOUT `gpu` prints the ROOT help and still exits 0, so the hook
 * must look for the `Usage: alfe gpu` line, not trust the exit code.
 */
// Shapes of commander 13's real output for `alfe gpu --help` (no single
// quotes: the fake prints them with a shell builtin, PATH has no cat).
const GPU_HELP = `Usage: alfe gpu [options] [command]

Rent GPU instances on Vast.ai through Alfe

Commands:
  search [options]  Search Vast.ai GPU offers
  destroy [options] <instanceId>  Destroy an instance now`;
const ROOT_HELP = `Usage: alfe [options] [command]

CLI for setting up and managing Alfe AI agents

Commands:
  setup [options]  Set up an agent
  aws              AWS commands`;

function runHealth({ alfe = 'new', ssh = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'alfe-vast-health-'));
  roots.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const bash = spawnSync('/usr/bin/env', ['which', 'bash'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(join(bin, 'bash'), `#!/bin/sh\nexec "${bash}" "$@"\n`, { mode: 0o755 });
  if (alfe !== 'missing') {
    writeFileSync(join(bin, 'alfe'), `#!/bin/sh
echo "$*" >> "${join(root, 'calls.log')}"
if [ "$1" = "gpu" ] && [ "$2" = "--help" ]; then
  printf '%s\\n' '${alfe === 'new' ? GPU_HELP : ROOT_HELP}'
  exit 0
fi
exit 1
`, { mode: 0o755 });
  }
  if (ssh) {
    for (const tool of ['ssh', 'scp', 'ssh-keygen']) writeFileSync(join(bin, tool), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  const result = spawnSync(join(bin, 'bash'), [join(hooksDir, 'health.sh')], { encoding: 'utf8', env: { HOME: root, PATH: bin } });
  let calls = '';
  try { calls = readFileSync(join(root, 'calls.log'), 'utf8'); } catch { /* alfe never ran */ }
  return { ...result, calls };
}

test('healthy when `alfe gpu --help` works; the only alfe call is the local help probe', () => {
  const result = runHealth();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /alfe gpu is available/u);
  assert.doesNotMatch(result.stdout, /WARNING|ERROR/u);
  assert.equal(result.calls.trim(), 'gpu --help');
});

test('an alfe CLI without `alfe gpu` (root help, exit 0) fails with an ERROR that says to update it', () => {
  const result = runHealth({ alfe: 'old' });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /ERROR: this alfe CLI predates `alfe gpu`/u);
});

test('no alfe on PATH fails with an ERROR', () => {
  const result = runHealth({ alfe: 'missing' });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /ERROR: alfe CLI not found on PATH/u);
});

test('missing OpenSSH tools only warn', () => {
  const result = runHealth({ ssh: false });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /WARNING: OpenSSH client tools missing: ssh scp ssh-keygen/u);
});
