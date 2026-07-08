#!/usr/bin/env node

/**
 * Microsoft 365 integration post_activate hook.
 *
 * Unlike the Google Workspace hook (which writes a per-account
 * `authorized_user` refresh-token file that the `gws` CLI reads), this hook
 * does NOT write any on-disk credential file. The Microsoft Graph CLI (`mgc`)
 * cannot authenticate non-interactively from an injected delegated refresh
 * token — its auth strategies are DeviceCode / InteractiveBrowser (need a
 * human at a browser) or ClientCertificate / Environment / ManagedIdentity
 * (app-only client-credentials, not our delegated authorization-code grant),
 * and it persists tokens in a proprietary MSAL cache with no hand-writable
 * credentials file. The old hook wrote `~/.config/mgc/credentials.json` in a
 * made-up format that `mgc` silently ignored.
 *
 * So the `@alfe.ai/openclaw-microsoft` plugin talks to graph.microsoft.com REST
 * directly, resolving accounts + access tokens from the Alfe API at runtime
 * (with token refresh delegated to the connect service). There is nothing to
 * materialise on disk. This hook only *validates* that credentials resolve so
 * a broken connection surfaces a clear message at activation time.
 *
 * Runs on every activation.
 */

import { resolveConfig } from '@alfe.ai/config';
import { AgentApiClient } from '@alfe.ai/agent-api-client';

const config = resolveConfig();
const client = new AgentApiClient({
  apiKey: config.apiKey,
  apiUrl: config.apiUrl,
});

let creds;
try {
  creds = await client.getMicrosoftCredentials();
} catch (err) {
  console.log(`No Microsoft credentials available — skipping Microsoft 365 setup (${err.message})`);
  process.exit(0);
}

// Support both the multi-account (accounts array) shape and, defensively, a
// legacy single-account shape — mirroring the Google hook's "support both"
// fallback during the connect wire-shape rollout.
const accounts = creds.accounts ?? [{
  email: creds.email,
  refreshToken: creds.refreshToken,
  clientId: creds.clientId,
  clientSecret: creds.clientSecret,
  displayName: undefined,
  connectedAt: undefined,
}];

if (accounts.length === 0 || !accounts[0]?.email) {
  console.log('No Microsoft account connected — nothing to configure');
  process.exit(0);
}

for (const account of accounts) {
  console.log(`Microsoft 365 ready for ${account.email} (Graph accessed directly by the openclaw-microsoft plugin)`);
}

console.log(`${accounts.length} Microsoft 365 account(s) connected`);
