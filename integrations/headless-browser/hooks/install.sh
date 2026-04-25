#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

# Install Google Chrome stable — required by OpenClaw's browser plugin.
# Config expects the binary at /usr/bin/google-chrome-stable.
if ! command -v google-chrome-stable &>/dev/null; then
  wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y /tmp/google-chrome.deb || apt-get install -fy
  rm -f /tmp/google-chrome.deb
fi

# Also install Playwright Chromium + system dependencies for compatibility.
npx playwright install chromium
npx playwright install-deps chromium
