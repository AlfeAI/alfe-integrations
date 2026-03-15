#!/usr/bin/env bash
# uninstall.sh — Alfe Chat integration uninstall hook.
#
# Called by the Alfe daemon when removing the chat integration.
# Removes the @alfe.ai/openclaw-chat plugin.
#
# Environment variables (set by the daemon):
#   ALFE_INTEGRATION_DIR  — path to this integration's cloned directory
#   ALFE_STATE_DIR        — path to ~/.alfe (state/config root)

set -euo pipefail

echo "[chat] Uninstalling @alfe.ai/openclaw-chat plugin..."

if command -v openclaw &>/dev/null; then
  openclaw plugin remove @alfe.ai/openclaw-chat 2>/dev/null || true
else
  npm uninstall -g @alfe.ai/openclaw-chat 2>/dev/null || true
fi

# Clean up state
STATE_DIR="${ALFE_STATE_DIR:-$HOME/.alfe}"
rm -rf "${STATE_DIR}/integrations/chat" 2>/dev/null || true

echo "[chat] Uninstall complete ✅"
