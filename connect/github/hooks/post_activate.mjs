#!/usr/bin/env node

import { resolveConfig } from '@alfe.ai/config';
import { AgentApiClient } from '@alfe.ai/agent-api-client';
import { homedir } from 'node:os';
import { GithubCliError, RosterError, accountSnapshot, syncGithubAccounts } from './gh-accounts.mjs';

const config = resolveConfig();
const client = new AgentApiClient({ apiKey: config.apiKey, apiUrl: config.apiUrl });

// Exit codes: 1 ONLY when the authoritative roster cannot be fetched or is
// invalid, so reconciliation retries (and nothing is pruned). Every gh-side
// problem is a redacted WARNING with exit 0: the shell half is optional and
// must never put the GitHub MCP tools into an error state.
let response;
try {
  response = await client.getGithubAccounts();
  accountSnapshot(response);
} catch (error) {
  const detail = error instanceof RosterError ? `: ${error.message}` : '';
  console.error(`GitHub account roster unavailable or invalid${detail}; existing gh accounts were not treated as a revoked roster`);
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  try {
    const result = syncGithubAccounts({ home: homedir(), response });
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
