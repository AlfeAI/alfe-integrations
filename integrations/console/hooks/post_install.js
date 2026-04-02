#!/usr/bin/env node

/**
 * Console integration post_install hook.
 *
 * Generates a gateway auth token on the agent (if one doesn't already exist)
 * and reports it to the cloud via the agent self-service API.
 *
 * The agent owns its credentials — the cloud never generates gateway tokens.
 */

import { resolveConfig } from '@alfe.ai/config';
import { AgentApiClient } from '@alfe.ai/agent-api-client';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const config = await resolveConfig();

// Check if a gateway token already exists in OpenClaw config
let token;
try {
  token = execFileSync('openclaw', ['config', 'get', 'gateway.auth.token'], {
    encoding: 'utf-8',
  }).trim();
} catch {
  token = '';
}

// Generate a new token if none exists
if (!token) {
  token = randomUUID();
  execFileSync('openclaw', ['config', 'set', 'gateway.auth.token', token]);
}

// Report the token to the cloud via agent self-service API
const client = new AgentApiClient({
  apiKey: config.apiKey,
  apiUrl: config.apiUrl,
});

await client.updateIntegrationConfig('console', { gateway_token: token });
