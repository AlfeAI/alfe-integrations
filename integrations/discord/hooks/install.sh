#!/bin/bash
# install.sh — Install @alfe.ai/openclaw-discord plugin
#
# Called by the Alfe daemon reconciliation engine when the Discord
# integration is being installed.

set -euo pipefail

PLUGIN_NAME="@alfe.ai/openclaw-discord"
STATE_DIR="${ALFE_STATE_DIR:-$HOME/.alfe/integrations/discord}"

echo "Installing ${PLUGIN_NAME}..."

# Try openclaw CLI first, fall back to npm
if command -v openclaw &>/dev/null; then
  openclaw plugin install "${PLUGIN_NAME}" || true
elif command -v npm &>/dev/null; then
  npm install -g "${PLUGIN_NAME}" 2>/dev/null || true
fi

# Create state marker
mkdir -p "${STATE_DIR}"
echo "installed" > "${STATE_DIR}/.state"
echo "✅ ${PLUGIN_NAME} installed"
