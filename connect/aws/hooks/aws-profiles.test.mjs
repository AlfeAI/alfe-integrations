import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  AwsHookError, BLOCK_BEGIN, BLOCK_END, RosterError, cacheFileName, checkHealth, parseBlock, readLedger,
  removeAwsProfiles, renderBlock, sectionProfiles, splitManagedBlock, syncAwsProfiles, validateRoster,
} from './aws-profiles.mjs';

const roots = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

const ALFE = '/usr/local/bin/alfe';

function home() {
  const root = mkdtempSync(join(tmpdir(), 'alfe-aws-hook-'));
  roots.push(root);
  return root;
}

const entry = (profile, extra = {}) => ({
  profile,
  roleArn: `arn:aws:iam::123456789012:role/${profile}`,
  accountId: '123456789012',
  region: 'us-east-1',
  label: null,
  connectionId: 'con_one',
  accountIdentifier: `${profile}#abc`,
  displayName: profile,
  connectedAt: '2026-10-01T00:00:00.000Z',
  ...extra,
});

const configPath = (h) => join(h, '.aws', 'config');
const readConfig = (h) => readFileSync(configPath(h), 'utf8');
const writeConfig = (h, text) => {
  mkdirSync(join(h, '.aws'), { recursive: true });
  writeFileSync(configPath(h), text);
};
const sync = (h, entries) => syncAwsProfiles({ home: h, profiles: validateRoster(entries).profiles, alfePath: ALFE });
const mode = (path) => lstatSync(path).mode & 0o777;

// ── Roster validation ───────────────────────────────────────────

test('validateRoster accepts the contract shape (array or {accounts}) and keeps only what it needs', () => {
  const { profiles, warnings } = validateRoster([entry('prod-admin'), entry('direct', { roleArn: null, region: 'eu-west-2' })]);
  assert.deepEqual(warnings, []);
  assert.deepEqual(profiles.map((p) => p.profile), ['prod-admin', 'direct']);
  assert.equal(profiles[1].roleArn, null);
  assert.equal(validateRoster({ accounts: [entry('a')] }).profiles.length, 1);
});

test('validateRoster dedups by profile, first wins, with a WARNING', () => {
  const { profiles, warnings } = validateRoster([entry('shared'), entry('shared', { connectionId: 'con_two' })]);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].connectionId, 'con_one');
  assert.match(warnings[0], /"shared" is provided by more than one connection; using con_one and ignoring con_two/u);
});

test('validateRoster rejects the WHOLE roster on any invalid entry', () => {
  const bad = [
    null,
    { accounts: 'nope' },
    [entry('ok'), entry('default')],
    [entry('Upper')],
    [entry('-lead')],
    [entry('ok', { region: 'us-east-1a' })],
    [entry('ok', { region: 'mars-1' })],
    [entry('ok', { connectionId: 'con one' })],
    [entry('ok', { connectionId: 'con_x --profile evil' })],
    [entry('ok', { accountId: '12345' })],
    [entry('ok', { roleArn: 'arn:aws-cn:iam::123456789012:role/x' })],
    [entry('ok', { roleArn: undefined })],
    [entry('ok', { label: 42 })],
    Array.from({ length: 257 }, (_, i) => entry(`p${i}`)),
  ];
  for (const roster of bad) assert.throws(() => validateRoster(roster), RosterError, JSON.stringify(roster)?.slice(0, 80));
});

test('validateRoster rejects GovCloud and China regions (commercial aws partition only)', () => {
  for (const region of ['us-gov-west-1', 'cn-north-1', 'cn-northwest-1']) {
    assert.throws(() => validateRoster([entry('p', { region })]), RosterError, region);
  }
});

test('newline injection is rejected in every field, including free text', () => {
  for (const field of ['profile', 'region', 'connectionId', 'roleArn', 'label', 'displayName', 'accountIdentifier']) {
    for (const breaker of ['\n', '\r']) {
      const value = field === 'roleArn' ? `arn:aws:iam::123456789012:role/x${breaker}[default]` : `x${breaker}credential_process = /bin/sh`;
      assert.throws(() => validateRoster([entry('ok', { [field]: value })]), RosterError, `${field} ${JSON.stringify(breaker)}`);
    }
  }
});

// ── Block parsing / rendering ───────────────────────────────────

test('renderBlock / parseBlock round-trip and the documented line format', () => {
  const profiles = validateRoster([entry('a'), entry('b', { region: 'eu-west-2', connectionId: 'con_two' })]).profiles;
  const block = renderBlock(profiles, ALFE);
  assert.ok(block.startsWith(`${BLOCK_BEGIN}\n[profile a]\nregion = us-east-1\ncredential_process = ${ALFE} aws credentials --connection con_one --profile a\n`));
  assert.ok(block.endsWith(`${BLOCK_END}\n`));
  assert.deepEqual(parseBlock(block).map((p) => [p.profile, p.region, p.connectionId]), [['a', 'us-east-1', 'con_one'], ['b', 'eu-west-2', 'con_two']]);
});

test('parseBlock rejects anything we would not have written', () => {
  const good = renderBlock(validateRoster([entry('a')]).profiles, ALFE);
  for (const edit of [
    good.replace('region = us-east-1', 'region = us-east-1\naws_access_key_id = AKIA0000'),
    good.replace('[profile a]', '[default]'),
    good.replace('--profile a', '--profile b'),
    good.replace(`credential_process = ${ALFE}`, 'credential_process = /bin/sh -c'),
    good.replace(/region = .*\n/u, ''),
  ]) assert.throws(() => parseBlock(edit), AwsHookError);
});

test('splitManagedBlock refuses unbalanced or repeated markers', () => {
  assert.equal(splitManagedBlock('[profile x]\n').present, false);
  for (const text of [`${BLOCK_BEGIN}\n`, `${BLOCK_END}\n`, `${BLOCK_END}\n${BLOCK_BEGIN}\n`, `${BLOCK_BEGIN}\n${BLOCK_END}\n${BLOCK_BEGIN}\n${BLOCK_END}\n`]) {
    assert.throws(() => splitManagedBlock(text), AwsHookError);
  }
});

test('sectionProfiles reads config and credentials headers, ignoring sso-session/services', () => {
  const names = sectionProfiles('[default]\n[profile  dev ]\n[sso-session corp]\n[services s3]\n[legacy]\n  [profile indented]\n');
  assert.deepEqual([...names].sort(), ['default', 'dev', 'indented', 'legacy']);
});

// ── Sync ────────────────────────────────────────────────────────

test('creates ~/.aws (0700) and a 0600 config containing only the block; never [default]', () => {
  const h = home();
  const result = sync(h, [entry('prod-admin'), entry('direct', { roleArn: null })]);
  assert.deepEqual(result.written, ['prod-admin', 'direct']);
  assert.equal(mode(join(h, '.aws')), 0o700);
  assert.equal(mode(configPath(h)), 0o600);
  const text = readConfig(h);
  assert.ok(text.startsWith(BLOCK_BEGIN));
  assert.doesNotMatch(text, /\[default\]/u);
  assert.doesNotMatch(text, /aws_access_key_id|aws_secret_access_key|aws_session_token/u);
  assert.deepEqual(readLedger(h), [{ profile: 'prod-admin', connectionId: 'con_one' }, { profile: 'direct', connectionId: 'con_one' }]);
  assert.equal(mode(join(h, '.alfe', 'aws-cli', 'owned-profiles.json')), 0o600);
});

test('rewrites ONLY the managed block; user content before and after is preserved byte-for-byte', () => {
  const h = home();
  const before = '# my config\r\n[default]\nregion = ap-southeast-2\n\n[profile mine]\nsso_session = corp\n';
  const after = '\n[sso-session corp]\nsso_start_url = https://example.awsapps.com/start\n# trailing comment without newline';
  writeConfig(h, `${before}${BLOCK_BEGIN}\n[profile old]\nregion = us-east-1\ncredential_process = ${ALFE} aws credentials --connection con_one --profile old\n${BLOCK_END}\n${after}`);
  sync(h, [entry('new')]);
  const text = readConfig(h);
  assert.ok(text.startsWith(before));
  assert.ok(text.endsWith(after));
  const parts = splitManagedBlock(text);
  assert.equal(parts.before, before);
  assert.equal(parts.after, after);
  assert.deepEqual(parseBlock(parts.block).map((p) => p.profile), ['new']);
});

test('appends the block to an existing config without a trailing newline, and removal restores the user text', () => {
  const h = home();
  writeConfig(h, '[default]\nregion = us-west-2\n');
  sync(h, [entry('a')]);
  assert.ok(readConfig(h).startsWith('[default]\nregion = us-west-2\n# >>> alfe managed'));
  sync(h, []);
  assert.equal(readConfig(h), '[default]\nregion = us-west-2\n');
});

test('a re-run with the same roster changes nothing', () => {
  const h = home();
  sync(h, [entry('a')]);
  const first = readConfig(h);
  const result = sync(h, [entry('a')]);
  assert.equal(result.changed, false);
  assert.equal(readConfig(h), first);
});

test('profiles that collide with user profiles (config or credentials file) are skipped with a WARNING', () => {
  const h = home();
  writeConfig(h, '[profile prod]\nregion = us-east-1\n');
  writeFileSync(join(h, '.aws', 'credentials'), '[staging]\naws_access_key_id = AKIAUSER\n');
  const result = sync(h, [entry('prod'), entry('staging'), entry('dev')]);
  assert.deepEqual(result.written, ['dev']);
  assert.equal(result.skipped, 2);
  assert.equal(result.warnings.filter((w) => /already exists outside the alfe managed block/u.test(w)).length, 2);
  assert.ok(readConfig(h).startsWith('[profile prod]\nregion = us-east-1\n'));
  assert.equal(readFileSync(join(h, '.aws', 'credentials'), 'utf8'), '[staging]\naws_access_key_id = AKIAUSER\n');
  assert.deepEqual(readLedger(h).map((p) => p.profile), ['dev']);
});

test('a symlinked ~/.aws/config is followed: the target is rewritten and the link kept', () => {
  const h = home();
  mkdirSync(join(h, '.aws'));
  mkdirSync(join(h, 'dotfiles'));
  writeFileSync(join(h, 'dotfiles', 'aws-config'), '[default]\n');
  symlinkSync(join(h, 'dotfiles', 'aws-config'), configPath(h));
  sync(h, [entry('a')]);
  assert.ok(lstatSync(configPath(h)).isSymbolicLink());
  assert.match(readFileSync(join(h, 'dotfiles', 'aws-config'), 'utf8'), /\[profile a\]/u);
});

test('a malformed existing block aborts without touching the config', () => {
  const h = home();
  const text = `[default]\n${BLOCK_BEGIN}\n[profile a]\n`;
  writeConfig(h, text);
  assert.throws(() => sync(h, [entry('a')]), AwsHookError);
  assert.equal(readConfig(h), text);
});

test('an unsafe alfe path is refused before any write', () => {
  const h = home();
  assert.throws(() => syncAwsProfiles({ home: h, profiles: [], alfePath: '/opt/my apps/alfe' }), AwsHookError);
  assert.equal(existsSync(join(h, '.aws')), false);
});

test('removed profiles have their cached STS credentials pruned; kept ones stay', () => {
  const h = home();
  sync(h, [entry('a'), entry('b')]);
  const cache = join(h, '.alfe', 'aws-cli', 'cache');
  mkdirSync(cache, { recursive: true });
  const fileA = join(cache, cacheFileName('con_one', 'a'));
  const fileB = join(cache, cacheFileName('con_one', 'b'));
  writeFileSync(fileA, '{}');
  writeFileSync(fileB, '{}');
  const result = sync(h, [entry('b')]);
  assert.equal(result.removed, 1);
  assert.equal(existsSync(fileA), false);
  assert.equal(existsSync(fileB), true);
  // Moving a profile to another connection prunes the old (connection, profile) entry.
  sync(h, [entry('b', { connectionId: 'con_two' })]);
  assert.equal(existsSync(fileB), false);
});

test('a cache entry that cannot be removed aborts the sync and stays stale so the next sync retries', { skip: process.getuid?.() === 0 && 'root ignores directory permissions' }, () => {
  const h = home();
  sync(h, [entry('a'), entry('b')]);
  const cache = join(h, '.alfe', 'aws-cli', 'cache');
  mkdirSync(cache, { recursive: true });
  const fileA = join(cache, cacheFileName('con_one', 'a'));
  writeFileSync(fileA, '{}');
  chmodSync(cache, 0o500);
  try {
    assert.throws(() => sync(h, [entry('b')]), AwsHookError);
    // The write-ahead ledger still lists the stale pair, so it is retried.
    assert.ok(readLedger(h).some((p) => p.profile === 'a'));
    assert.equal(existsSync(fileA), true);
  } finally {
    chmodSync(cache, 0o700);
  }
  const result = sync(h, [entry('b')]);
  assert.equal(result.pruned, 1);
  assert.equal(existsSync(fileA), false);
  assert.ok(!readLedger(h).some((p) => p.profile === 'a'));
});

test('cacheFileName is sha256(connectionId + NUL + profile) + .json (CLI contract)', () => {
  // Independent computation so the contract is pinned, not echoed.
  const expected = createHash('sha256').update(Buffer.from('con_1\u0000p', 'utf8')).digest('hex');
  assert.equal(cacheFileName('con_1', 'p'), `${expected}.json`);
});

test('a corrupt ownership record aborts sync without touching the config', () => {
  const h = home();
  writeConfig(h, '[default]\n');
  mkdirSync(join(h, '.alfe', 'aws-cli'), { recursive: true });
  writeFileSync(join(h, '.alfe', 'aws-cli', 'owned-profiles.json'), '{"version":1,"profiles":[{"profile":"../x"}]}');
  assert.throws(() => sync(h, [entry('a')]), AwsHookError);
  assert.equal(readConfig(h), '[default]\n');
});

// ── Uninstall ───────────────────────────────────────────────────

test('uninstall removes the block, ownership record and cache; user content stays', () => {
  const h = home();
  writeConfig(h, '[default]\nregion = us-west-2\n');
  sync(h, [entry('a')]);
  const cache = join(h, '.alfe', 'aws-cli', 'cache');
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, cacheFileName('con_one', 'a')), '{}');
  writeFileSync(join(h, '.alfe', 'keep.json'), '{}');
  const result = removeAwsProfiles({ home: h });
  assert.deepEqual([result.blockRemoved, result.cacheRemoved], [true, true]);
  assert.equal(readConfig(h), '[default]\nregion = us-west-2\n');
  assert.equal(existsSync(join(h, '.alfe', 'aws-cli')), false);
  assert.equal(existsSync(join(h, '.alfe', 'keep.json')), true);
  // Idempotent, and fine when nothing was ever installed.
  assert.deepEqual(removeAwsProfiles({ home: h }), { blockRemoved: false, cacheRemoved: false, warnings: [] });
  assert.deepEqual(removeAwsProfiles({ home: home() }), { blockRemoved: false, cacheRemoved: false, warnings: [] });
});

test('uninstall unlinks a symlinked cache dir without following it', () => {
  const h = home();
  sync(h, [entry('a')]);
  const elsewhere = join(h, 'elsewhere');
  mkdirSync(elsewhere);
  writeFileSync(join(elsewhere, 'precious'), 'x');
  symlinkSync(elsewhere, join(h, '.alfe', 'aws-cli', 'cache'));
  removeAwsProfiles({ home: h });
  assert.equal(existsSync(join(elsewhere, 'precious')), true);
});

// ── Health ──────────────────────────────────────────────────────

test('checkHealth: healthy without config, healthy with our block, fails on malformed block or ledger', () => {
  const h = home();
  assert.equal(checkHealth({ home: h }).ok, true);
  sync(h, [entry('a')]);
  const healthy = checkHealth({ home: h });
  assert.equal(healthy.ok, true);
  assert.match(healthy.messages.join('\n'), /1 Alfe-managed AWS profile\(s\): a/u);
  writeFileSync(configPath(h), readConfig(h).replace('region = us-east-1', 'region = us-east-1\naws_secret_access_key = x'));
  assert.equal(checkHealth({ home: h }).ok, false);
  writeFileSync(configPath(h), `${BLOCK_BEGIN}\n`);
  assert.equal(checkHealth({ home: h }).ok, false);
  const other = home();
  mkdirSync(join(other, '.alfe', 'aws-cli'), { recursive: true });
  writeFileSync(join(other, '.alfe', 'aws-cli', 'owned-profiles.json'), '{');
  assert.equal(checkHealth({ home: other }).ok, false);
});
