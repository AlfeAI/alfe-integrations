import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync, statSync, unlinkSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { syncCredentialFiles, removeCredentialFiles } from './credential-files.mjs';

const homes = [];
const home = () => {
  const path = mkdtempSync(join(tmpdir(), 'alfe-google-credentials-'));
  homes.push(path);
  return path;
};
const account = (email = 'member@example.com', refreshToken = 'refresh-token') => ({ email, refreshToken, clientId: 'client-id', clientSecret: 'client-secret' });
const file = (root, email = 'member@example.com', name = 'credentials.json') => join(root, '.config', `gws-${email.replace(/[@.]/gu, '-')}`, name);
const ledgerPath = (root) => join(root, '.alfe', 'google-workspace', 'owned-files.json');
const ledger = (root) => JSON.parse(readFileSync(ledgerPath(root), 'utf8')).files;
const hashFile = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
function failCredentialRename(t, path, run) {
  const rename = fs.renameSync;
  const target = fs.realpathSync(path);
  const stub = t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === target) throw new Error('Injected credential write failure');
    return rename(from, to);
  });
  syncBuiltinESMExports();
  try { assert.throws(run, /Injected credential write failure/); }
  finally {
    stub.mock.restore();
    syncBuiltinESMExports();
  }
}
afterEach(() => { for (const path of homes.splice(0)) rmSync(path, { recursive: true, force: true }); });

test('grant, change, revoke, and repeated empty response converge only hook-owned files', () => {
  const root = home();
  syncCredentialFiles(root, { accounts: [account()] });
  assert.equal(statSync(file(root)).mode & 0o777, 0o600);
  syncCredentialFiles(root, { accounts: [account('member@example.com', 'new-token'), account('other@example.com')] });
  assert.equal(JSON.parse(readFileSync(file(root), 'utf8')).refresh_token, 'new-token');
  writeFileSync(file(root, 'member@example.com', 'notes.txt'), 'user-owned');
  writeFileSync(file(root, 'member@example.com', 'token_cache.json'), 'gws-runtime-owned');
  syncCredentialFiles(root, { accounts: [account('other@example.com')] });
  assert.equal(existsSync(file(root)), false);
  assert.equal(existsSync(file(root, 'member@example.com', 'client_secret.json')), false);
  assert.equal(readFileSync(file(root, 'member@example.com', 'notes.txt'), 'utf8'), 'user-owned');
  assert.equal(readFileSync(file(root, 'member@example.com', 'token_cache.json'), 'utf8'), 'gws-runtime-owned');
  assert.equal(existsSync(file(root, 'other@example.com')), true);
  syncCredentialFiles(root, { accounts: [] });
  syncCredentialFiles(root, { accounts: [] });
  assert.equal(existsSync(file(root, 'other@example.com')), false);
});

test('invalid or incomplete response never changes or prunes existing files', () => {
  const root = home();
  syncCredentialFiles(root, { accounts: [account()] });
  const before = readFileSync(file(root), 'utf8');
  for (const invalid of [undefined, {}, { email: 'legacy@example.com' }, { accounts: [account('new@example.com'), {}] }, { accounts: [account('../escape@example.com')] }, { accounts: [account('a.b@example.com'), account('a-b@example.com')] }, { accounts: [account(), account('MEMBER@example.com')] }, { accounts: [account('member@example.com', '')] }]) {
    assert.throws(() => syncCredentialFiles(root, invalid));
    assert.equal(readFileSync(file(root), 'utf8'), before);
    assert.equal(existsSync(file(root, 'new@example.com')), false);
  }
});

test('untracked existing account files are not inferred to be owned', () => {
  const root = home();
  const existing = file(root, 'untracked@example.com');
  mkdirSync(join(root, '.config', 'gws-untracked-example-com'), { recursive: true });
  writeFileSync(existing, 'pre-existing');
  syncCredentialFiles(root, { accounts: [] });
  removeCredentialFiles(root);
  assert.equal(readFileSync(existing, 'utf8'), 'pre-existing');
});

test('uninstall removes recorded files and preserves externally changed ones', () => {
  const root = home();
  syncCredentialFiles(root, { accounts: [account(), account('other@example.com')] });
  writeFileSync(file(root), 'operator-replaced');
  assert.deepEqual(removeCredentialFiles(root), { preserved: 1 });
  assert.equal(readFileSync(file(root), 'utf8'), 'operator-replaced');
  assert.equal(existsSync(file(root, 'member@example.com', 'client_secret.json')), false);
  assert.equal(existsSync(file(root, 'other@example.com')), false);
  assert.deepEqual(removeCredentialFiles(root), { preserved: 0 });
});

test('symlinked credential directory or file cannot redirect writes or cleanup', () => {
  const root = home();
  const outside = home();
  mkdirSync(join(root, '.config'));
  symlinkSync(outside, join(root, '.config', 'gws-member-example-com'));
  assert.throws(() => syncCredentialFiles(root, { accounts: [account()] }), /real directory/);
  assert.equal(existsSync(join(outside, 'credentials.json')), false);
  unlinkSync(join(root, '.config', 'gws-member-example-com'));
  syncCredentialFiles(root, { accounts: [account()] });
  rmSync(file(root));
  writeFileSync(join(outside, 'keep'), 'untouched');
  symlinkSync(join(outside, 'keep'), file(root));
  assert.throws(() => removeCredentialFiles(root), /regular file/);
  assert.equal(readFileSync(join(outside, 'keep'), 'utf8'), 'untouched');
});

test('malformed ownership ledger refuses cleanup outside known contribution files', () => {
  const root = home();
  syncCredentialFiles(root, { accounts: [account()] });
  const ledger = join(root, '.alfe', 'google-workspace', 'owned-files.json');
  writeFileSync(ledger, JSON.stringify({ version: 1, files: [{ directory: '../../', file: 'credentials.json', sha256: 'a'.repeat(64) }] }));
  assert.throws(() => removeCredentialFiles(root), /ownership entry/);
  assert.equal(existsSync(file(root)), true);
});

test('failed stale-account prune leaves the full old/new roster union loadable and cleanable', () => {
  const root = home();
  const outside = home();
  const old = Array.from({ length: 128 }, (_, i) => account(`old${i}@example.com`));
  const next = Array.from({ length: 128 }, (_, i) => account(`new${i}@example.com`));
  syncCredentialFiles(root, { accounts: old });
  const blocked = file(root, old[0].email, 'client_secret.json');
  unlinkSync(blocked);
  writeFileSync(join(outside, 'keep'), 'unrelated');
  symlinkSync(join(outside, 'keep'), blocked);

  assert.throws(() => syncCredentialFiles(root, { accounts: next }), /regular file/);
  assert.equal(ledger(root).length, 512); // Larger than the old reader's 384 cap.
  assert.equal(existsSync(file(root, next[127].email)), true);
  unlinkSync(blocked);
  removeCredentialFiles(root);
  for (const entry of [...old, ...next]) assert.equal(existsSync(file(root, entry.email)), false);
  assert.equal(readFileSync(join(outside, 'keep'), 'utf8'), 'unrelated');
});

test('interrupted same-path token replacement preserves both owned digests for cleanup', (t) => {
  const root = home();
  syncCredentialFiles(root, { accounts: [account()] });
  const previous = hashFile(file(root));
  const changed = { ...account('member@example.com', 'changed-token'), clientSecret: 'changed-client-secret' };
  failCredentialRename(t, file(root), () => syncCredentialFiles(root, { accounts: [account('new@example.com'), changed] }));

  const pending = ledger(root).find((entry) => entry.directory === 'gws-member-example-com' && entry.file === 'credentials.json');
  assert.equal(pending.previousSha256, previous);
  assert.notEqual(pending.sha256, previous);
  assert.equal(hashFile(file(root)), previous);
  assert.equal(JSON.parse(readFileSync(file(root, 'member@example.com', 'client_secret.json'), 'utf8')).installed.client_secret, 'changed-client-secret');
  assert.equal(existsSync(file(root, 'new@example.com')), true);

  removeCredentialFiles(root);
  assert.equal(existsSync(file(root)), false);
  assert.equal(existsSync(file(root, 'member@example.com', 'client_secret.json')), false);
  assert.equal(existsSync(file(root, 'new@example.com')), false);
});

test('retry after a partial write converges, finalizes ownership, and remains cleanable', (t) => {
  const root = home();
  syncCredentialFiles(root, { accounts: [account(), account('removed@example.com')] });
  const response = { accounts: [account('new@example.com'), account('member@example.com', 'changed-token')] };
  failCredentialRename(t, file(root), () => syncCredentialFiles(root, response));
  syncCredentialFiles(root, response);
  assert.equal(JSON.parse(readFileSync(file(root), 'utf8')).refresh_token, 'changed-token');
  assert.equal(existsSync(file(root, 'removed@example.com')), false);
  assert.equal(ledger(root).length, 4);
  assert.equal(ledger(root).some((entry) => entry.previousSha256 !== undefined), false);
  removeCredentialFiles(root);
  assert.equal(existsSync(file(root)), false);
  assert.equal(existsSync(file(root, 'new@example.com')), false);
});

test('interrupted replacement never records an operator-modified file hash as owned', (t) => {
  const root = home();
  syncCredentialFiles(root, { accounts: [account()] });
  writeFileSync(file(root), 'operator-replaced');
  const operatorDigest = hashFile(file(root));
  failCredentialRename(t, file(root), () => syncCredentialFiles(root, { accounts: [account('member@example.com', 'new-token')] }));
  const pending = ledger(root).find((entry) => entry.file === 'credentials.json');
  assert.equal(pending.previousSha256, undefined);
  assert.notEqual(pending.sha256, operatorDigest);
  assert.deepEqual(removeCredentialFiles(root), { preserved: 1 });
  assert.equal(readFileSync(file(root), 'utf8'), 'operator-replaced');
});

test('rejects a write-ahead union over the bound before writing any credential', () => {
  const root = home();
  syncCredentialFiles(root, { accounts: [] });
  const files = Array.from({ length: 4096 }, (_, i) => ({ directory: `gws-old${i}-example-com`, file: 'credentials.json', sha256: 'a'.repeat(64) }));
  writeFileSync(ledgerPath(root), JSON.stringify({ version: 1, files }));
  assert.throws(() => syncCredentialFiles(root, { accounts: [account()] }), /capacity exceeded/);
  assert.equal(existsSync(file(root)), false);
  assert.equal(ledger(root).length, 4096);
  removeCredentialFiles(root); // The previous ledger remains loadable.
  assert.equal(ledger(root).length, 0);
});
