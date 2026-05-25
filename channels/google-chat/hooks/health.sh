#!/usr/bin/env bash
set -euo pipefail

# Google Chat integration health check — verify the plugin is installed.
if npm list -g @alfe.ai/openclaw-google-chat &>/dev/null 2>&1; then
  echo "Google Chat plugin installed"
else
  echo "WARN: @alfe.ai/openclaw-google-chat not found globally (may be local)"
fi
