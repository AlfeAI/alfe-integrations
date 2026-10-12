#!/usr/bin/env node

import { homedir } from 'node:os';
import { AwsHookError, removeAwsProfiles } from './aws-profiles.mjs';

// Always exit 0: a failing post_uninstall would wedge integration removal.
// The AWS CLI itself stays installed (a system tool other software may use).
try {
  const result = removeAwsProfiles({ home: homedir() });
  console.log(`Removed Alfe-managed AWS profiles: block ${result.blockRemoved ? 'removed' : 'absent'}, credential cache ${result.cacheRemoved ? 'removed' : 'absent'}`);
  for (const warning of result.warnings) console.warn(`WARNING: ${warning}`);
} catch (error) {
  const detail = error instanceof AwsHookError ? `: ${error.message}` : error?.code ? `: ${String(error.code)}` : '';
  console.warn(`WARNING: AWS profile cleanup did not complete${detail}`);
}
