#!/usr/bin/env node

import { resolveConfig } from '@alfe.ai/config';
import { AgentApiClient } from '@alfe.ai/agent-api-client';
import { homedir } from 'node:os';
import { GithubCliError, HOOK_BUDGET_MS, RosterError, accountSnapshot, syncGithubAccounts } from './gh-accounts.mjs';

// The daemon kills hooks at 30 s, measured from spawn. Count node startup, the
// roster fetch and the gh sync against one budget anchored at process start.
const started = performance.timeOrigin;
const remaining = () => HOOK_BUDGET_MS - (Date.now() - started);
const FETCH_TIMEOUT_MS = 10_000;

const config = resolveConfig();
const client = new AgentApiClient({ apiKey: config.apiKey, apiUrl: config.apiUrl });

// Exit codes: 1 ONLY when the authoritative roster cannot be fetched or is
// invalid, so reconciliation retries (and nothing is pruned). Every gh-side
// problem is a redacted WARNING with exit 0: the shell half is optional and
// must never put the GitHub MCP tools into an error state.
let response;
try {
  // getGithubAccounts() takes no signal and its transport retries, so bound
  // it here. A timeout is a fetch failure: exit 1, nothing pruned.
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('roster fetch timed out')), Math.max(0, Math.min(FETCH_TIMEOUT_MS, remaining())));
  });
  try {
    response = await Promise.race([client.getGithubAccounts(), timeout]);
  } finally {
    clearTimeout(timer);
  }
  accountSnapshot(response);
} catch (error) {
  const detail = error instanceof RosterError ? `: ${error.message}` : '';
  console.error(`GitHub account roster unavailable or invalid${detail}; existing gh accounts were not treated as a revoked roster`);
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  try {
    const result = syncGithubAccounts({ home: homedir(), response, budgetMs: remaining() });
    if (result.skipped) {
      console.warn(`WARNING: GitHub shell credentials not configured: ${result.skipped}. GitHub MCP tools are unaffected.`);
    } else {
      console.log(`Configured ${result.accounts} GitHub account(s) for gh/git: ${result.loggedIn} logged in, ${result.unchanged} unchanged, ${result.removed} removed, ${result.preserved} preserved; active=${result.active ?? 'none'}; git helper ${result.gitHelper}`);
    }
    for (const warning of result.warnings) console.warn(`WARNING: ${warning}`);
  } catch (error) {
    // Only our own errors are constructed redacted; never print anything else.
    const detail = error instanceof GithubCliError ? `: ${error.message}` : '';
    console.warn(`WARNING: GitHub CLI credential sync did not run${detail}. GitHub MCP tools are unaffected.`);
  }
}

// An abandoned (timed-out) fetch may still hold a socket open; never let it
// keep the hook alive past the daemon's kill.
process.exit(process.exitCode ?? 0);
