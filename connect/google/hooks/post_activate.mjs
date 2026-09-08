#!/usr/bin/env node

import { resolveConfig } from '@alfe.ai/config';
import { AgentApiClient } from '@alfe.ai/agent-api-client';
import { homedir } from 'node:os';
import { syncCredentialFiles } from './credential-files.mjs';

const config = resolveConfig();
const client = new AgentApiClient({ apiKey: config.apiKey, apiUrl: config.apiUrl });

try {
  // Fetch/validate the complete roster before pruning. An unavailable resolver
  // must fail activation so reconciliation retries, never look like no accounts.
  const credentials = await client.getGoogleCredentials();
  const result = syncCredentialFiles(homedir(), credentials);
  console.log(`Configured ${result.accounts} Google account(s); preserved ${result.preserved} externally modified file(s)`);
} catch {
  console.error('Google credential synchronization failed; existing credentials were not treated as a revoked account roster');
  process.exitCode = 1;
}
