#!/usr/bin/env bash
set -euo pipefail

# Check gws CLI is installed
if ! command -v gws &>/dev/null; then
  echo "ERROR: gws CLI not found"
  exit 1
fi

echo "gws CLI available: $(gws --version)"
