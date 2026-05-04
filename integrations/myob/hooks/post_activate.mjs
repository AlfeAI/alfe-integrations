#!/usr/bin/env node

/**
 * MYOB integration post_activate hook.
 *
 * Verifies MYOB credentials are available, then configures the
 * myob-mcp-server in OpenClaw's config. The MCP server handles
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

// Verify MYOB is connected before configuring MCP server
let creds;
try {
  creds = await client.getMYOBCredentials();
} catch (err) {
  console.log(`No MYOB credentials available — skipping MCP server setup (${err.message})`);
  process.exit(0);
}

if (!creds?.accessToken || !creds?.myobBusinessId) {
  console.log('No MYOB access token or business — skipping MCP server setup');
  process.exit(0);
}

// Register the MCP server via openclaw config set.
// The server reads credentials from the Alfe API at startup — no secrets in config.
const batch = [
  { path: 'mcp.servers.myob.command', value: 'npx' },
  { path: 'mcp.servers.myob.args', value: ['-y', '@alfe.ai/openclaw-myob'] },
];

try {
  await execFileAsync('openclaw', [
    'config', 'set', '--batch-json', JSON.stringify(batch), '--strict-json',
  ], { timeout: 10_000 });
  console.log('MYOB MCP server configured');
} catch (err) {
  console.error(`Failed to configure MYOB MCP server: ${err.message}`);
  process.exit(1);
}
