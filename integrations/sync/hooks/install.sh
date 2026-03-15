#!/usr/bin/env bash
# integration-sync install hook
# Installs the @alfe.ai/openclaw-sync plugin package.
set -euo pipefail

echo "Installing @alfe.ai/openclaw-sync plugin..."

# Try openclaw CLI first, fall back to npm
if command -v openclaw &>/dev/null; then
  openclaw plugin install @alfe.ai/openclaw-sync || npm install -g @alfe.ai/openclaw-sync
else
  npm install -g @alfe.ai/openclaw-sync
fi

echo "✅ @alfe.ai/openclaw-sync installed"
