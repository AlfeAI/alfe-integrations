#!/bin/bash
# install.sh — Install the @alfe.ai/openclaw-mobile plugin
set -e

echo "[integration-mobile] Installing @alfe.ai/openclaw-mobile..."

# Try openclaw CLI first, fall back to npm
if command -v openclaw >/dev/null 2>&1; then
  openclaw plugin install @alfe.ai/openclaw-mobile || npm install -g @alfe.ai/openclaw-mobile
else
  npm install -g @alfe.ai/openclaw-mobile
fi

echo "[integration-mobile] ✅ Plugin installed"
