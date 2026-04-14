#!/usr/bin/env node

/**
 * Microsoft 365 integration post_activate hook.
 *
 * Fetches decrypted OAuth credentials from the Alfe API and writes
 * them to ~/.config/mgc/ so the Microsoft Graph CLI (mgc) can
 * authenticate with Microsoft 365 APIs (Outlook, OneDrive, Calendar, etc.).
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
  creds = await client.getMicrosoftCredentials();
} catch (err) {
  console.log(`No Microsoft credentials available — skipping mgc auth setup (${err.message})`);
  process.exit(0);
}

if (!creds?.refreshToken) {
  console.log('No Microsoft refresh token available — skipping mgc auth setup');
  process.exit(0);
}

const configDir = join(homedir(), '.config', 'mgc');
mkdirSync(configDir, { recursive: true, mode: 0o700 });

// Write OAuth credentials for mgc CLI
writeFileSync(
  join(configDir, 'credentials.json'),
  JSON.stringify({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    tenant_id: 'common',
  }, null, 2) + '\n',
  { mode: 0o600 },
);

console.log(`mgc CLI configured for ${creds.email}`);
