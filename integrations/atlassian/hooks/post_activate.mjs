#!/usr/bin/env node

/**
 * Atlassian integration post_activate hook.
 *
 * Seeds the sooperset/mcp-atlassian token file at
 *   ~/.mcp-atlassian/oauth-{clientId}.json
 * so the MCP server can bootstrap its internal refresh loop without
 * making a Connect call on every startup.
 *
 * The MCP server registration itself is handled by the integration
 * framework's `mcp-applier` (see manifest `mcp_servers[]` + the
 * `{{credentials.atlassian.*}}` and `{{alfe.apiUrl}}` interpolation).
 * The hook only exists for this token-file side effect, which is not
 * something the applier can do.
 *
 * Runs on every activation to keep the token file current. Gracefully
 * skips when Atlassian isn't connected yet (the applier also skips
 * MCP registration in that case via `requires_credentials: atlassian`).
 */

import { resolveConfig } from '@alfe.ai/config';
import { AgentApiClient } from '@alfe.ai/agent-api-client';
import { writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const config = resolveConfig();
const client = new AgentApiClient({
  apiKey: config.apiKey,
  apiUrl: config.apiUrl,
});

let creds;
try {
  creds = await client.getAtlassianCredentials();
} catch (err) {
  if (err.message?.includes('(404)')) {
    console.log('Atlassian not connected — skipping token-file seed');
    process.exit(0);
  }
  console.error(`Failed to get Atlassian credentials: ${err.message}`);
  process.exit(1);
}

if (!creds?.accessToken || !creds?.cloudId) {
  console.log('No Atlassian access token or site — skipping token-file seed');
  process.exit(0);
}

if (!creds?.refreshToken) {
  console.log('No Atlassian refresh token — MCP server will not be able to auto-refresh');
  process.exit(0);
}

const clientId = creds.clientId;
if (!clientId) {
  console.log('No Atlassian OAuth client ID in credentials — skipping token-file seed');
  process.exit(0);
}

const tokenDir = join(homedir(), '.mcp-atlassian');
const tokenFilePath = join(tokenDir, `oauth-${clientId}.json`);

try {
  await mkdir(tokenDir, { recursive: true });
  await writeFile(tokenFilePath, JSON.stringify({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
    expires_at: creds.accessTokenExpiresAt
      ? Math.floor(new Date(creds.accessTokenExpiresAt).getTime() / 1000)
      : Math.floor(Date.now() / 1000) + 3600,
    cloud_id: creds.cloudId,
    token_type: 'Bearer',
  }, null, 2));
  console.log(`Seeded Atlassian token file at ${tokenFilePath}`);
} catch (err) {
  console.error(`Failed to seed Atlassian token file: ${err.message}`);
  process.exit(1);
}
