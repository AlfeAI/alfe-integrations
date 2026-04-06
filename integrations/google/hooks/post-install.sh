#!/usr/bin/env bash
set -euo pipefail

# Install Google Workspace CLI if not present
if ! command -v gws &>/dev/null; then
  echo "Installing Google Workspace CLI..."
  npm install -g @googleworkspace/cli
fi

echo "gws CLI version: $(gws --version)"
