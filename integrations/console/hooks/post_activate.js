#!/usr/bin/env node

/**
 * Console integration post_activate hook.
 *
 * Runs on every activation to ensure the local gateway auth token is
 * synced to the cloud. The local token always takes precedence — if one
 * exists, it is pushed to the cloud; if not, a new one is generated.
 *
 * NOTE: We read the token from openclaw.json directly because
 * `openclaw config get` redacts secret values (__OPENCLAW_REDACTED__).
 * Writing still goes through `openclaw config set` to avoid clobbering.
 *
 * The agent owns its credentials — the cloud never generates gateway tokens.
 */

import { resolveConfig } from '@alfe.ai/config';
import { AgentApiClient } from '@alfe.ai/agent-api-client';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const config = resolveConfig();

// Read existing token directly from openclaw.json (CLI output redacts secrets).
let token = '';
try {
  const stateDir = process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw');
  const configPath = process.env.OPENCLAW_CONFIG_PATH || join(stateDir, 'openclaw.json');
  const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  token = raw?.gateway?.auth?.token ?? '';
} catch {
  // Config file missing or malformed — will generate a new token below.
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
