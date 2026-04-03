#!/usr/bin/env node

/**
 * Console integration post_activate hook.
 *
 * Runs on every activation to ensure the local gateway auth token is
 * synced to the cloud. The local token always takes precedence — if one
 * exists, it is pushed to the cloud; if not, a new one is generated.
 *
 * This handles:
 * - First install (token generated + pushed)
 * - Re-activation after error/restart (token re-synced)
 * - Cloud record wiped (local token re-pushed)
 * - Local token regenerated (local takes precedence)
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

// Always push local token to cloud — local takes precedence
const client = new AgentApiClient({
  apiKey: config.apiKey,
  apiUrl: config.apiUrl,
});

await client.updateIntegrationConfig('console', { gateway_token: token });
