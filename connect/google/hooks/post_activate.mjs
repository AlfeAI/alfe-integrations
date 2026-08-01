#!/usr/bin/env node

/**
 * Google Workspace integration post_activate hook.
 *
 * Fetches decrypted OAuth credentials from the Alfe API and writes
 * them to per-account config directories so the gws CLI can
 * authenticate with Google Workspace APIs.
 *
 * Multi-account support:
 *   - Every account → ~/.config/gws-<sanitized-email>/
 *   - The openclaw-google plugin sets GOOGLE_WORKSPACE_CLI_CONFIG_DIR to
 *     that per-email dir when running gws for a given account.
 *
 * Runs on every activation to keep credentials in sync.
 */

import { resolveConfig } from '@alfe.ai/config';
import { AgentApiClient } from '@alfe.ai/agent-api-client';
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const MAX_ACCOUNTS = 128;
const MAX_SECRET_CHARS = 64 * 1024;
const EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/u;

const config = resolveConfig();
const client = new AgentApiClient({
  apiKey: config.apiKey,
  apiUrl: config.apiUrl,
});

let creds;
try {
  creds = await client.getGoogleCredentials();
} catch {
  console.log('No Google credentials available — skipping gws auth setup');
  process.exit(0);
}

if (!Array.isArray(creds.accounts) || creds.accounts.length > MAX_ACCOUNTS) {
  throw new Error(`Google credentials response must contain at most ${MAX_ACCOUNTS} accounts`);
}
if (creds.accounts.length === 0) {
  console.log('No Google refresh token available — skipping gws auth setup');
  process.exit(0);
}

/**
 * Sanitize email for use as a directory name.
 * badi@olinga.com.au → badi-olinga-com-au
 */
function sanitizeEmail(email) {
  return email.replace(/@/g, '-').replace(/\./g, '-');
}

function validateEmail(value) {
  if (
    typeof value !== 'string' ||
    value.length > 320 ||
    value !== value.trim() ||
    value.includes('/') ||
    value.includes('\\') ||
    !EMAIL_PATTERN.test(value)
  ) {
    throw new Error('Google credential email is invalid');
  }
  return value;
}

function validateSecret(value, label) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > MAX_SECRET_CHARS ||
    value.includes('\0')
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function validateServices(value) {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > 128 ||
    value.some((service) => typeof service !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(service))
  ) {
    throw new Error('Google enabled services are invalid');
  }
  return value;
}

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temporaryPath, filePath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

const selectors = new Set();
const directories = new Set();
const accounts = creds.accounts.map((raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Google credential account is invalid');
  const email = validateEmail(raw.email);
  const selector = email.toLowerCase();
  if (selectors.has(selector)) throw new Error('Google credential accounts contain a duplicate email');
  selectors.add(selector);
  const directoryName = `gws-${sanitizeEmail(email)}`;
  const directoryKey = directoryName.toLowerCase();
  if (directories.has(directoryKey)) throw new Error('Google credential emails map to an ambiguous gws config directory');
  directories.add(directoryKey);
  return {
    email,
    directoryName,
    refreshToken: validateSecret(raw.refreshToken, 'Google refresh token'),
    clientId: validateSecret(raw.clientId, 'Google OAuth client id'),
    clientSecret: validateSecret(raw.clientSecret, 'Google OAuth client secret'),
    enabledServices: validateServices(raw.enabledServices),
  };
});

for (const account of accounts) {
  // Every account gets its own per-email config dir. The openclaw-google
  // plugin resolves ALL accounts at ~/.config/gws-<sanitized-email>/
  // (the "default account → ~/.config/gws/" concept was removed 2026-05-14);
  // special-casing the first account to a bare `gws/` dir wrote creds to a
  // path the plugin never reads, leaving that account's email unreachable.
  const configDir = join(homedir(), '.config', account.directoryName);
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  chmodSync(configDir, 0o700);

  // Write OAuth client credentials (matches Google's client_secret.json format)
  // Note: project_id is intentionally omitted — gws sends it as x-goog-user-project
  // header which triggers a serviceUsageConsumer permission check that external
  // Google Workspace users cannot satisfy on our GCP project.
  writeJsonAtomic(
    join(configDir, 'client_secret.json'), {
      installed: {
        client_id: account.clientId,
        client_secret: account.clientSecret,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
      },
    },
  );

  // Write refresh token credentials (standard Google authorized_user format)
  writeJsonAtomic(
    join(configDir, 'credentials.json'), {
      type: 'authorized_user',
      client_id: account.clientId,
      client_secret: account.clientSecret,
      refresh_token: account.refreshToken,
    },
  );

  // Write enabled services config
  if (account.enabledServices) {
    writeJsonAtomic(join(configDir, 'services.json'), { enabled: account.enabledServices });
  }

  console.log(`gws CLI configured for ${account.email} at ${configDir}`);
}

console.log(`${accounts.length} Google account(s) configured`);
