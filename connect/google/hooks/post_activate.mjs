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
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const config = resolveConfig();
const client = new AgentApiClient({
  apiKey: config.apiKey,
  apiUrl: config.apiUrl,
});

let creds;
try {
  creds = await client.getGoogleCredentials();
} catch (err) {
  console.log(`No Google credentials available — skipping gws auth setup (${err.message})`);
  process.exit(0);
}

// Support both multi-account (accounts array) and legacy single-account format
const accounts = creds.accounts ?? [{
  email: creds.email,
  refreshToken: creds.refreshToken,
  clientId: creds.clientId,
  clientSecret: creds.clientSecret,
  enabledServices: creds.enabledServices,
  isDefault: true,
  displayName: undefined,
}];

if (accounts.length === 0 || !accounts[0]?.refreshToken) {
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

for (let i = 0; i < accounts.length; i++) {
  const account = accounts[i];
  if (!account.refreshToken) continue;

  // Every account gets its own per-email config dir. The openclaw-google
  // plugin resolves ALL accounts at ~/.config/gws-<sanitized-email>/
  // (the "default account → ~/.config/gws/" concept was removed 2026-05-14);
  // special-casing the first account to a bare `gws/` dir wrote creds to a
  // path the plugin never reads, leaving that account's email unreachable.
  const configDir = join(homedir(), '.config', `gws-${sanitizeEmail(account.email)}`);
  mkdirSync(configDir, { recursive: true, mode: 0o700 });

  // Write OAuth client credentials (matches Google's client_secret.json format)
  // Note: project_id is intentionally omitted — gws sends it as x-goog-user-project
  // header which triggers a serviceUsageConsumer permission check that external
  // Google Workspace users cannot satisfy on our GCP project.
  writeFileSync(
    join(configDir, 'client_secret.json'),
    JSON.stringify({
      installed: {
        client_id: account.clientId,
        client_secret: account.clientSecret,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
      },
    }, null, 2) + '\n',
    { mode: 0o600 },
  );

  // Write refresh token credentials (standard Google authorized_user format)
  writeFileSync(
    join(configDir, 'credentials.json'),
    JSON.stringify({
      type: 'authorized_user',
      client_id: account.clientId,
      client_secret: account.clientSecret,
      refresh_token: account.refreshToken,
    }, null, 2) + '\n',
    { mode: 0o600 },
  );

  // Write enabled services config
  if (account.enabledServices) {
    writeFileSync(
      join(configDir, 'services.json'),
      JSON.stringify({ enabled: account.enabledServices }, null, 2) + '\n',
      { mode: 0o600 },
    );
  }

  console.log(`gws CLI configured for ${account.email} at ${configDir}`);
}

console.log(`${accounts.length} Google account(s) configured`);
