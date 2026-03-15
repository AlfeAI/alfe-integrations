#!/bin/bash
# uninstall.sh — Remove @alfe.ai/openclaw-discord plugin
#
# Called by the Alfe daemon when the Discord integration is being removed.

set -euo pipefail

PLUGIN_NAME="@alfe.ai/openclaw-discord"
STATE_DIR="${ALFE_STATE_DIR:-$HOME/.alfe/integrations/discord}"

echo "Uninstalling ${PLUGIN_NAME}..."

# Try openclaw CLI first, fall back to npm
if command -v openclaw &>/dev/null; then
  openclaw plugin remove "${PLUGIN_NAME}" || true
elif command -v npm &>/dev/null; then
  npm uninstall -g "${PLUGIN_NAME}" 2>/dev/null || true
fi

# Clean up state
if [ -d "${STATE_DIR}" ]; then
  rm -rf "${STATE_DIR}"
fi

echo "✅ ${PLUGIN_NAME} uninstalled"
