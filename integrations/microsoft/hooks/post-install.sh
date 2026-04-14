#!/usr/bin/env bash
set -euo pipefail

# Install Microsoft Graph CLI if not present
if ! command -v mgc &>/dev/null; then
  echo "Installing Microsoft Graph CLI..."
  npm install -g @microsoft/microsoft-graph-cli
fi

echo "mgc CLI version: $(mgc --version)"
