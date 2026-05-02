#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

# OpenClaw's browser extension uses bundled playwright-core to drive a system
# Chrome install via CDP. The integration manifest pins
# `browser.executablePath: /usr/bin/google-chrome-stable`, so the only thing
# this hook needs to do is install Chrome. We don't need the `playwright` npm
# package or its bundled chromium binaries — both go unused at runtime.

if command -v google-chrome-stable &>/dev/null; then
  echo "google-chrome-stable already installed: $(google-chrome-stable --version 2>/dev/null || echo 'version unknown')"
  exit 0
fi

echo "Installing google-chrome-stable..."
TMP_DEB="$(mktemp --suffix=.deb)"
trap 'rm -f "${TMP_DEB}"' EXIT

wget -q -O "${TMP_DEB}" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb

# `apt-get install -y <local.deb>` fails if any declared dep is missing.
# `-fy` (fix-broken) pulls them in. Run both: success on either path is fine.
if ! apt-get install -y "${TMP_DEB}"; then
  echo "Initial apt install failed — running apt-get install -fy to resolve missing deps"
  apt-get install -fy
fi

echo "google-chrome-stable installed: $(google-chrome-stable --version 2>/dev/null || echo 'version unknown')"
