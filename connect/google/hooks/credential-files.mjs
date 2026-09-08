import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EMAIL = /^[A-Za-z0-9.!#$%&'*+=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/u;
const FILES = new Set(['client_secret.json', 'credentials.json', 'services.json']);
const digest = (text) => createHash('sha256').update(text).digest('hex');

function directory(path) {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Google credential directory must be a real directory');
  return path;
}

function regularFile(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Google credential path must be a regular file');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function writeAtomic(path, text) {
  regularFile(path);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function string(value, label, max = 16_384) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`Invalid Google ${label}`);
  }
  return value;
}

/** Validate the entire authoritative response before touching any credential file. */
export function credentialSnapshot(response) {
  if (!response || !Array.isArray(response.accounts) || response.accounts.length > 128) {
    throw new Error('Google credentials response must contain a complete bounded accounts array');
  }
  const directories = new Set();
  return response.accounts.map((account) => {
    const email = string(account?.email, 'account email', 320);
    if (!EMAIL.test(email)) throw new Error('Invalid Google account email');
    const name = `gws-${email.replace(/[@.]/gu, '-')}`;
    const key = name.toLowerCase();
    if (directories.has(key)) throw new Error('Google accounts map to an ambiguous credential directory');
    directories.add(key);
    const clientId = string(account.clientId, 'client ID');
    const clientSecret = string(account.clientSecret, 'client secret');
    const refreshToken = string(account.refreshToken, 'refresh token');
    return {
      name,
      files: {
        'client_secret.json': {
          installed: { client_id: clientId, client_secret: clientSecret, auth_uri: 'https://accounts.google.com/o/oauth2/auth', token_uri: 'https://oauth2.googleapis.com/token' },
        },
        'credentials.json': { type: 'authorized_user', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken },
      },
    };
  });
}

function context(home) {
  const root = realpathSync(home);
  const config = directory(join(root, '.config'));
  const alfe = directory(join(root, '.alfe'));
  const state = directory(join(alfe, 'google-workspace'));
  const path = join(state, 'owned-files.json');
  let owned = [];
  if (regularFile(path)) {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (raw.version !== 1 || !Array.isArray(raw.files) || raw.files.length > 384) {
      throw new Error('Invalid Google credential ownership ledger');
    }
    const keys = new Set();
    owned = raw.files.map((entry) => {
      if (!entry || typeof entry.directory !== 'string' || !/^gws-[A-Za-z0-9!#$%&'*+=?^_`{|}~-]+$/u.test(entry.directory)
        || entry.directory.length > 324 || !FILES.has(entry.file) || !/^[a-f0-9]{64}$/u.test(entry.sha256)) {
        throw new Error('Invalid Google credential ownership entry');
      }
      const key = `${entry.directory}/${entry.file}`;
      if (keys.has(key)) throw new Error('Duplicate Google credential ownership entry');
      keys.add(key);
      return { directory: entry.directory, file: entry.file, sha256: entry.sha256 };
    });
  }
  return { config, path, owned };
}

/** Only files previously written by this hook, with their exact recorded content, may be removed. */
function prune(ctx, keep) {
  let preserved = 0;
  for (const entry of ctx.owned) {
    if (keep.has(`${entry.directory}/${entry.file}`)) continue;
    const parent = join(ctx.config, entry.directory);
    if (!existsSync(parent)) continue;
    directory(parent);
    const path = join(parent, entry.file);
    if (!regularFile(path)) continue;
    if (digest(readFileSync(path)) === entry.sha256) unlinkSync(path);
    else preserved += 1;
  }
  return preserved;
}

export function syncCredentialFiles(home, response) {
  const snapshot = credentialSnapshot(response);
  const ctx = context(home);
  const next = [];
  const keep = new Set();
  // Validate all destinations before writing, including a symlink in a later account.
  for (const account of snapshot) {
    const path = directory(join(ctx.config, account.name));
    for (const file of Object.keys(account.files)) regularFile(join(path, file));
  }
  for (const account of snapshot) {
    for (const [file, value] of Object.entries(account.files)) {
      const text = `${JSON.stringify(value, null, 2)}\n`;
      writeAtomic(join(ctx.config, account.name, file), text);
      next.push({ directory: account.name, file, sha256: digest(text) });
      keep.add(`${account.name}/${file}`);
    }
  }
  const preserved = prune(ctx, keep);
  writeAtomic(ctx.path, `${JSON.stringify({ version: 1, files: next }, null, 2)}\n`);
  return { accounts: snapshot.length, preserved };
}

/** Explicit integration uninstall removes its tracked contribution, preserving unrelated files. */
export function removeCredentialFiles(home) {
  const ctx = context(home);
  const preserved = prune(ctx, new Set());
  writeAtomic(ctx.path, `${JSON.stringify({ version: 1, files: [] }, null, 2)}\n`);
  return { preserved };
}
