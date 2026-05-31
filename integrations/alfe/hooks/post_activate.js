#!/usr/bin/env node

/**
 * alfe integration post_activate hook (formerly console integration's).
 *
 * Originally the only hook for the standalone `console` integration; PR
 * 12 of channels-and-credential-driven-integrations folded console
 * into alfe and this hook moved with it. alfe is universally installed,
 * so the loopback-token bootstrap now runs on every agent rather than
 * only on agents that explicitly opted into console.
 *
 * Ensures the local OpenClaw gateway has an auth token in
 * `~/.openclaw/openclaw.json` under `gateway.auth.token`. The daemon's
 * tunnel handler reads that token to authenticate its own loopback
 * requests when forwarding console traffic to localhost:18789.
 *
 * NOTE: We read the existing token via the JSON file because
 * `openclaw config get` redacts secret values (__OPENCLAW_REDACTED__).
 * Writes still go through `openclaw config set` to avoid clobbering.
 *
 * The token is NOT pushed to the cloud — it stays on the agent host.
 * The console service uses the gateway tunnel to reach the daemon,
 * which injects this token on the way to OpenClaw.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

let token = '';
try {
  const stateDir = process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw');
  const configPath = process.env.OPENCLAW_CONFIG_PATH || join(stateDir, 'openclaw.json');
  const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  token = raw?.gateway?.auth?.token ?? '';
} catch {
  // Config file missing or malformed — generate one below.
}

if (!token) {
  token = randomUUID();
  execFileSync('openclaw', ['config', 'set', 'gateway.auth.token', token]);
}
