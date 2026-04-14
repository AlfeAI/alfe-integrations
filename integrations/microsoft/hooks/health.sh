#!/usr/bin/env bash
set -euo pipefail

# Check mgc CLI is installed
if ! command -v mgc &>/dev/null; then
  echo "ERROR: mgc CLI not found"
  exit 1
fi

echo "mgc CLI available: $(mgc --version)"
