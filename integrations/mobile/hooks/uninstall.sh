#!/bin/bash
# uninstall.sh — Remove the mobile plugin and release the phone number
set -e

STATE_DIR="${ALFE_STATE_DIR:-$HOME/.alfe/integrations/mobile}"

echo "[integration-mobile] Uninstalling @alfe.ai/openclaw-mobile..."

# Remove plugin
if command -v openclaw >/dev/null 2>&1; then
  openclaw plugin remove @alfe.ai/openclaw-mobile 2>/dev/null || true
else
  npm uninstall -g @alfe.ai/openclaw-mobile 2>/dev/null || true
fi

# Clean up state
if [ -d "$STATE_DIR" ]; then
  rm -rf "$STATE_DIR"
  echo "[integration-mobile] State directory cleaned"
fi

echo "[integration-mobile] ✅ Plugin uninstalled"
