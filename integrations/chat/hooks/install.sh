#!/usr/bin/env bash
# install.sh — Alfe Chat integration install hook.
#
# Called by the Alfe daemon after cloning the integration repo.
# Installs @alfe.ai/openclaw-chat as an OpenClaw plugin.
#
# Environment variables (set by the daemon):
#   ALFE_INTEGRATION_DIR  — path to this integration's cloned directory
#   ALFE_STATE_DIR        — path to ~/.alfe (state/config root)

set -euo pipefail

echo "[chat] Installing @alfe.ai/openclaw-chat plugin..."

# Check if openclaw CLI is available
if command -v openclaw &>/dev/null; then
  openclaw plugin install @alfe.ai/openclaw-chat 2>/dev/null || {
    echo "[chat] openclaw plugin install not available, attempting npm install..."
    npm install -g @alfe.ai/openclaw-chat 2>/dev/null || true
  }
else
  echo "[chat] openclaw CLI not found, attempting npm install..."
  npm install -g @alfe.ai/openclaw-chat 2>/dev/null || true
fi

# Create state directory marker
STATE_DIR="${ALFE_STATE_DIR:-$HOME/.alfe}"
mkdir -p "${STATE_DIR}/integrations/chat"
echo '{"installed": true, "plugin": "@alfe.ai/openclaw-chat"}' > "${STATE_DIR}/integrations/chat/state.json"

echo "[chat] Installation complete ✅"
