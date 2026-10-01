#!/usr/bin/env node

import { homedir } from 'node:os';
import { GithubCliError, removeGithubAccounts } from './gh-accounts.mjs';

// Always exit 0: a failing post_uninstall would wedge integration removal.
// Anything not removed stays recorded in the ledger for a later cleanup.
try {
  const result = removeGithubAccounts({ home: homedir() });
  console.log(`Removed ${result.removed} Alfe-managed GitHub CLI account(s); preserved ${result.preserved} externally modified; retained ${result.retained}; git helper ${result.gitHelper}`);
  for (const warning of result.warnings) console.warn(`WARNING: ${warning}`);
} catch (error) {
  const detail = error instanceof GithubCliError ? `: ${error.message}` : '';
  console.warn(`WARNING: GitHub CLI credential cleanup did not run${detail}; nothing was removed`);
}
