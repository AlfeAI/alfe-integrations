#!/usr/bin/env node

import { homedir } from 'node:os';
import { removeCredentialFiles } from './credential-files.mjs';

try {
  const result = removeCredentialFiles(homedir());
  console.log(`Removed Google integration credential files; preserved ${result.preserved} externally modified file(s)`);
} catch {
  console.error('Google credential cleanup failed');
  process.exitCode = 1;
}
