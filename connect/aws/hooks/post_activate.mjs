#!/usr/bin/env node

import { resolveConfig } from '@alfe.ai/config';
import { AgentApiClient } from '@alfe.ai/agent-api-client';
import { homedir } from 'node:os';
import {
  AwsHookError, FETCH_TIMEOUT_MS, HOOK_BUDGET_MS, PROBE_TIMEOUT_MS, RosterError,
  checkAlfeCli, syncAwsProfiles, validateRoster,
} from './aws-profiles.mjs';

// The daemon kills hooks at 30 s, measured from spawn. Count node startup, the
// CLI probe, the roster fetch and the config write against one budget.
const started = performance.timeOrigin;
const remaining = () => HOOK_BUDGET_MS - (Date.now() - started);

// Exit codes (see ../DEVELOPING.md "Exit-code contract"): 1 when the host
// cannot run the profiles yet (no usable `alfe aws` CLI, or a shared
// agent-api-client without getAwsProfiles()) or the roster cannot be fetched
// or is invalid. Nothing is changed in those cases, and the failed activation
// leaves the integration in `error`, which the daemon re-activates on a later
// DESIRED_STATE (fresh budget after every daemon restart, including the one a
// CLI upgrade performs). A local config problem is a WARNING with exit 0.
async function main() {
  const cli = checkAlfeCli({ timeout: Math.max(1_000, Math.min(PROBE_TIMEOUT_MS, remaining() - FETCH_TIMEOUT_MS)) });
  if (!cli.ok) {
    console.error(`ERROR: ${cli.message}; AWS profiles were not configured. They are written on the next activation after this is fixed.`);
    process.exitCode = 1;
    return;
  }
  const { alfePath } = cli;

  const config = resolveConfig();
  const client = new AgentApiClient({ apiKey: config.apiKey, apiUrl: config.apiUrl });
  if (typeof client.getAwsProfiles !== 'function') {
    console.error('ERROR: the installed @alfe.ai/agent-api-client has no getAwsProfiles(); AWS profiles were not configured. The daemon refreshes the shared packages before the next activation.');
    process.exitCode = 1;
    return;
  }

  let roster;
  try {
    // getAwsProfiles() takes no signal and its transport retries, so bound it.
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('AWS profile fetch timed out')), Math.max(0, Math.min(FETCH_TIMEOUT_MS, remaining())));
    });
    try {
      roster = validateRoster(await Promise.race([client.getAwsProfiles(), timeout]));
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const detail = error instanceof RosterError ? `: ${error.message}` : '';
    console.error(`AWS profile roster unavailable or invalid${detail}; ~/.aws/config was not changed`);
    process.exitCode = 1;
    return;
  }
  for (const warning of roster.warnings) console.warn(`WARNING: ${warning}`);

  try {
    const result = syncAwsProfiles({ home: homedir(), profiles: roster.profiles, alfePath });
    console.log(`Configured ${result.written.length} AWS profile(s) in ${result.configPath}: ${result.written.join(', ') || 'none'}; ${result.skipped} skipped, ${result.removed} removed`);
    for (const warning of result.warnings) console.warn(`WARNING: ${warning}`);
  } catch (error) {
    // Only our own errors are constructed safe to print.
    const detail = error instanceof AwsHookError ? `: ${error.message}` : error?.code ? `: ${String(error.code)}` : '';
    console.warn(`WARNING: AWS profiles were not configured${detail}.`);
  }
}

await main();

// An abandoned (timed-out) fetch may still hold a socket open; never let it
// keep the hook alive past the daemon's kill. Drain stdout/stderr first:
// process.exit() can drop queued writes when the daemon captures them via pipes.
const code = process.exitCode ?? 0;
setTimeout(() => process.exit(code), 1_000);
process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
