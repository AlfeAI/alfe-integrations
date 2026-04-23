#!/usr/bin/env node

/**
 * Atlassian integration post_activate hook.
 *
 * Fetches OAuth2 credentials from the Alfe API, seeds the
 * sooperset/mcp-atlassian token file (~/.mcp-atlassian/oauth-{clientId}.json),
 * and configures the MCP server in OpenClaw's config.
 *
 * The MCP server auto-refreshes tokens internally using its standard OAuth mode
 * (client_id + client_secret + seeded refresh token).
 *
 * Runs on every activation to ensure the token file and MCP config are current.
 */

import { resolveConfig } from '@alfe.ai/config';
import { AgentApiClient } from '@alfe.ai/agent-api-client';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

const config = resolveConfig();
const client = new AgentApiClient({
  apiKey: config.apiKey,
  apiUrl: config.apiUrl,
});

// Verify Atlassian is connected before configuring MCP server
let creds;
try {
  creds = await client.getAtlassianCredentials();
} catch (err) {
  console.error(`Failed to get Atlassian credentials: ${err.message}`);
  process.exit(1);
}

if (!creds?.accessToken || !creds?.cloudId) {
  console.log('No Atlassian access token or site — skipping MCP server setup');
  process.exit(0);
}

if (!creds?.refreshToken) {
  console.log('No Atlassian refresh token — MCP server will not be able to auto-refresh');
  process.exit(0);
}

// Seed the token file for sooperset/mcp-atlassian.
// The MCP server looks for ~/.mcp-atlassian/oauth-{clientId}.json and uses
// its standard OAuth mode (client_id + client_secret) to auto-refresh.
const clientId = creds.clientId;
if (!clientId) {
  console.log('No Atlassian OAuth client ID in credentials — skipping MCP server setup');
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

// Configure the MCP server in OpenClaw via `openclaw config set`.
// Env vars tell mcp-atlassian to use standard OAuth mode (which reads the seeded token file).
const clientSecret = creds.clientSecret;
const redirectUri = `${config.apiUrl}/atlassian/oauth/callback`;
const scopeString = 'read:me offline_access read:jira-work write:jira-work read:jira-user manage:jira-project read:confluence-content.all write:confluence-content.all read:confluence-space.summary read:confluence-user';

const batch = [
  { path: 'mcpServers.atlassian.command', value: 'uvx' },
  { path: 'mcpServers.atlassian.args', value: ['mcp-atlassian'] },
  { path: 'mcpServers.atlassian.env.ATLASSIAN_OAUTH_CLIENT_ID', value: clientId },
  ...(clientSecret ? [{ path: 'mcpServers.atlassian.env.ATLASSIAN_OAUTH_CLIENT_SECRET', value: clientSecret }] : []),
  { path: 'mcpServers.atlassian.env.ATLASSIAN_OAUTH_CLOUD_ID', value: creds.cloudId },
  { path: 'mcpServers.atlassian.env.ATLASSIAN_OAUTH_SCOPE', value: scopeString },
  { path: 'mcpServers.atlassian.env.ATLASSIAN_OAUTH_REDIRECT_URI', value: redirectUri },
];

try {
  await execFileAsync('openclaw', [
    'config', 'set', '--batch-json', JSON.stringify(batch), '--strict-json',
  ], { timeout: 10_000 });
  console.log('Atlassian MCP server configured');
} catch (err) {
  console.error(`Failed to configure Atlassian MCP server: ${err.message}`);
  process.exit(1);
}
