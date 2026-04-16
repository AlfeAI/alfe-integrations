#!/usr/bin/env node

/**
 * GitHub integration post_activate hook.
 *
 * Verifies GitHub credentials are available, then configures the
 * GitHub MCP server in OpenClaw's config. GitHub OAuth App tokens
 * don't expire, so no proxy wrapper is needed — the token is written
 * directly to OpenClaw config as an environment variable.
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

// Verify GitHub is connected before configuring MCP server
let creds;
try {
  creds = await client.getGithubCredentials();
} catch (err) {
  console.log(`No GitHub credentials available — skipping MCP server setup (${err.message})`);
  process.exit(0);
}

if (!creds?.accessToken) {
  console.log('No GitHub access token — skipping MCP server setup');
  process.exit(0);
}

// Register the GitHub MCP server via openclaw config set.
// Token is written as an env var — OpenClaw spawns the process with it.
const batch = [
  { path: 'mcp.servers.github-github.command', value: 'npx' },
  { path: 'mcp.servers.github-github.args', value: ['-y', '@modelcontextprotocol/server-github'] },
  { path: 'mcp.servers.github-github.env.GITHUB_PERSONAL_ACCESS_TOKEN', value: creds.accessToken },
];

try {
  await execFileAsync('openclaw', [
    'config', 'set', '--batch-json', JSON.stringify(batch), '--strict-json',
  ], { timeout: 10_000 });
  console.log(`GitHub MCP server configured for @${creds.login}`);
} catch (err) {
  console.error(`Failed to configure GitHub MCP server: ${err.message}`);
  process.exit(1);
}
