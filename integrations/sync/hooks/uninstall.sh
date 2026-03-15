#!/usr/bin/env bash
# integration-sync uninstall hook
# Removes the @alfe.ai/openclaw-sync plugin and cleans up state.
set -euo pipefail

echo "Uninstalling @alfe.ai/openclaw-sync plugin..."

# Remove plugin package
if command -v openclaw &>/dev/null; then
  openclaw plugin remove @alfe.ai/openclaw-sync 2>/dev/null || true
fi
npm uninstall -g @alfe.ai/openclaw-sync 2>/dev/null || true

# Clean up state directory
STATE_DIR="${ALFE_STATE_DIR:-$HOME/.alfe/integrations/sync}"
if [ -d "$STATE_DIR" ]; then
  rm -rf "$STATE_DIR"
  echo "Cleaned up state directory: $STATE_DIR"
fi

echo "✅ @alfe.ai/openclaw-sync uninstalled"
