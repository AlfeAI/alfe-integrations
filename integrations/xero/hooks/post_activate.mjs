#!/usr/bin/env node

/**
 * Xero integration post_activate hook.
 *
 * Verifies Xero credentials are available, then configures the
 * xero-mcp-proxy MCP server in OpenClaw's config. The proxy handles
 * credential fetching and token refresh internally.
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

// Verify Xero is connected before configuring MCP server
let creds;
try {
  creds = await client.getXeroCredentials();
} catch (err) {
  console.log(`No Xero credentials available — skipping MCP server setup (${err.message})`);
  process.exit(0);
}

if (!creds?.accessToken || !creds?.xeroTenantId) {
  console.log('No Xero access token or tenant — skipping MCP server setup');
  process.exit(0);
}

// Register the proxy MCP server via openclaw config set.
// The proxy reads credentials from the Alfe API at startup — no secrets in config.
const batch = [
  { path: 'mcp.servers.xero.command', value: 'xero-mcp-proxy' },
  { path: 'mcp.servers.xero.args', value: [] },
];

try {
  await execFileAsync('openclaw', [
    'config', 'set', '--batch-json', JSON.stringify(batch), '--strict-json',
  ], { timeout: 10_000 });
  console.log('Xero MCP proxy server configured');
} catch (err) {
  console.error(`Failed to configure Xero MCP server: ${err.message}`);
  process.exit(1);
}
