#!/usr/bin/env bash
set -euo pipefail

# Teams integration health check
# Verifies the openclaw-teams plugin is loaded
if openclaw plugins list 2>/dev/null | grep -q "openclaw-teams"; then
  echo "Teams plugin loaded"
else
  echo "WARNING: openclaw-teams plugin not detected"
fi
