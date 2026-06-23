#!/usr/bin/env bash
# Install Google Chrome for OpenClaw's headless browser tool.
#
# OpenClaw's browser extension uses bundled playwright-core to drive a system
# Chrome install via CDP. The integration manifest pins
# `browser.executablePath: /usr/bin/google-chrome-stable`, so the only thing
# this hook needs to do is install Chrome. We don't need the `playwright` npm
# package or its bundled chromium binaries — both go unused at runtime.
#
# Success is defined by Chrome being PRESENT at the end, not by apt's exit code.
# apt triggers needrestart, which can exit non-zero even when Chrome installed
# fine; under `set -e` that aborted this hook and marked the integration failed
# despite a working Chrome (which then left openclaw's browser control disabled).
set -uo pipefail

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export NEEDRESTART_SUSPEND=1

chrome_ready() { command -v google-chrome-stable >/dev/null 2>&1; }

if chrome_ready; then
  echo "google-chrome-stable already installed: $(google-chrome-stable --version 2>/dev/null || echo 'version unknown')"
  exit 0
fi

echo "Installing google-chrome-stable..."
TMP_DEB="$(mktemp --suffix=.deb)"
trap 'rm -f "${TMP_DEB}"' EXIT

wget -q -O "${TMP_DEB}" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb || true

# `apt-get install -y <local.deb>` fails if any declared dep is missing; `-fy`
# (fix-broken) pulls them in. Either path may print needrestart noise and exit
# non-zero benignly — don't let that abort the hook. The presence check below is
# the source of truth.
apt-get install -y "${TMP_DEB}" || apt-get install -fy || true

if chrome_ready; then
  echo "google-chrome-stable installed: $(google-chrome-stable --version 2>/dev/null || echo 'version unknown')"
  exit 0
fi

echo "ERROR: google-chrome-stable not found after install attempt" >&2
exit 1
