#!/usr/bin/env node

/**
 * Notion integration post_activate hook.
 *
 * Verifies Notion credentials are available, then configures the
 * notion-mcp-proxy MCP server in OpenClaw's config. The proxy handles
 * credential fetching internally.
 *
 * Runs on every activation to ensure the MCP server is configured.
 */

import { resolveConfig } from '@alfe.ai/config';
import { AgentApiClient } from '@alfe.ai/agent-api-client';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const config = resolveConfig();
const client = new AgentApiClient({
  apiKey: config.apiKey,
  apiUrl: config.apiUrl,
});

// Verify Notion is connected before configuring MCP server
let creds;
try {
  creds = await client.getNotionCredentials();
} catch (err) {
  console.log(`No Notion credentials available — skipping MCP server setup (${err.message})`);
  process.exit(0);
}

if (!creds?.accessToken) {
  console.log('No Notion access token — skipping MCP server setup');
  process.exit(0);
}

// Register the proxy MCP server via openclaw config set.
// The proxy reads credentials from the Alfe API at startup — no secrets in config.
const batch = [
  { path: 'mcp.servers.notion.command', value: 'npx' },
  { path: 'mcp.servers.notion.args', value: ['-y', '@alfe.ai/openclaw-notion'] },
];

try {
  await execFileAsync('openclaw', [
    'config', 'set', '--batch-json', JSON.stringify(batch), '--strict-json',
  ], { timeout: 10_000 });
  console.log('Notion MCP proxy server configured');
} catch (err) {
  console.error(`Failed to configure Notion MCP server: ${err.message}`);
  process.exit(1);
}
