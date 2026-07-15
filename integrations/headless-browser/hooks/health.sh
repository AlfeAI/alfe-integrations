#!/usr/bin/env bash
set -uo pipefail

# Off Linux/apt, install.sh intentionally skips Chrome install (see install.sh),
# so a missing google-chrome-stable is expected there and NOT a failure — mirror
# that so health doesn't flap actual_status on self-hosted (e.g. macOS) agents.
if [ "$(uname -s)" != "Linux" ] || ! command -v apt-get >/dev/null 2>&1; then
  echo "healthy: non-Linux host, Chrome install not applicable"
  exit 0
fi

if command -v google-chrome-stable &>/dev/null; then
  echo "healthy"
  exit 0
fi
echo "unhealthy: google-chrome-stable not found"
exit 1
