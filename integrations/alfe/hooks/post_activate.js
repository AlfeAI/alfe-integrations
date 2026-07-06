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
 *
 * RACE-HARDENING: this runs at the tail of activation, right after the
 * applier's `openclaw config set --batch-json`. Each `config set` triggers
 * an async runtime hot-reload that rewrites openclaw.json, so a `config set`
 * that races the in-flight reload fails with a bare "Command failed". We
 * retry with backoff and re-read the file before each attempt (another writer
 * may have set the token), and on failure we emit a SCRUBBED message — the
 * failed argv contains the token, so it must never reach stderr (which the
 * daemon surfaces in the integration's user-facing errorMessage).
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const RETRIES = 5;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 4000;

const stateDir = process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw');
const configPath = process.env.OPENCLAW_CONFIG_PATH || join(stateDir, 'openclaw.json');

/** Synchronous sleep — this hook runs sync (execFileSync), so block cleanly. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readToken() {
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    return raw?.gateway?.auth?.token ?? '';
  } catch {
    // Config file missing or malformed — treat as absent.
    return '';
  }
}

/**
 * This hook is an OpenClaw-only concern (the token lives in openclaw.json and
 * writes go through `openclaw config set`). On agents running another runtime
 * (e.g. hermes) there is no `openclaw` binary, so the token bootstrap is a
 * no-op — exit 0 instead of burning retries and failing activation. Probe the
 * canonical install path first so a transiently wrong PATH on an OpenClaw box
 * can't false-negative us into silently skipping the real bootstrap; only if
 * the binary is missing there do we fall back to a PATH lookup.
 * (Framework-side gating on supported_agents ships with the daemon; this
 * probe keeps the manifest safe on daemons that predate it.)
 */
function openclawAvailable() {
  if (existsSync('/usr/local/bin/openclaw')) return true;
  try {
    execFileSync('openclaw', ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

if (!openclawAvailable()) {
  process.stdout.write('post_activate: openclaw binary not found — skipping gateway.auth.token bootstrap (non-openclaw runtime)\n');
  process.exit(0);
}

if (!readToken()) {
  const token = randomUUID();
  let written = false;
  let lastStderr = '';

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    // A concurrent writer (or a prior attempt whose write landed despite a
    // reported failure) may have set the token since we last looked.
    if (readToken()) {
      written = true;
      break;
    }
    try {
      // Capture stderr (don't inherit) so a failure can't print the token argv.
      execFileSync('openclaw', ['config', 'set', 'gateway.auth.token', token], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      written = true;
      break;
    } catch (err) {
      lastStderr = err && err.stderr ? String(err.stderr).trim() : '';
      if (attempt < RETRIES) {
        // Exponential backoff (capped) to let the hot-reload settle.
        sleep(Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt));
      }
    }
  }

  if (!written) {
    // Scrub: never echo the token (it lives in the failed command's argv).
    process.stderr.write(
      `post_activate: failed to set gateway.auth.token after ${RETRIES + 1} attempts` +
        (lastStderr ? `: ${lastStderr}` : '') +
        '\n',
    );
    process.exit(1);
  }
}
