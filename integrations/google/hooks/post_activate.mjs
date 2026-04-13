#!/usr/bin/env node

/**
 * Google Workspace integration post_activate hook.
 *
 * Fetches decrypted OAuth credentials from the Alfe API and writes
 * them to ~/.config/gws/ so the gws CLI can authenticate with Google
 * Workspace APIs (Gmail, Drive, Calendar, Sheets, etc.).
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

if (!creds?.refreshToken) {
  console.log('No Google refresh token available — skipping gws auth setup');
  process.exit(0);
}

const configDir = join(homedir(), '.config', 'gws');
mkdirSync(configDir, { recursive: true, mode: 0o700 });

// Write OAuth client credentials (matches Google's client_secret.json format)
writeFileSync(
  join(configDir, 'client_secret.json'),
  JSON.stringify({
    installed: {
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    },
  }, null, 2) + '\n',
  { mode: 0o600 },
);

// Write refresh token credentials
writeFileSync(
  join(configDir, 'credentials.json'),
  JSON.stringify({
    refresh_token: creds.refreshToken,
  }, null, 2) + '\n',
  { mode: 0o600 },
);

console.log(`gws CLI configured for ${creds.email}`);
