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

# Chrome-via-.deb is a Linux/apt concern. Managed agents run on Linux VMs where
# the manifest's `/usr/bin/google-chrome-stable` path is real. On self-hosted
# agents (e.g. macOS) that path can never exist, `apt-get`/`wget` are absent,
# and GNU `mktemp --suffix` isn't supported by BSD mktemp — so this hook could
# NEVER succeed and instead hard-failed every daemon reconcile pass. Skip
# cleanly off Linux/apt: the user's own browser is the headless target there,
# and failing reconciliation over it is far worse than a no-op.
if [ "$(uname -s)" != "Linux" ] || ! command -v apt-get >/dev/null 2>&1; then
  echo "headless-browser: not a Linux/apt host — skipping Chrome install (nothing to do here)"
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export NEEDRESTART_SUSPEND=1

chrome_ready() { command -v google-chrome-stable >/dev/null 2>&1; }

if chrome_ready; then
  echo "google-chrome-stable already installed: $(google-chrome-stable --version 2>/dev/null || echo 'version unknown')"
  exit 0
fi

echo "Installing google-chrome-stable..."
# mktemp -d (portable on GNU + BSD) + a named .deb inside it: apt only accepts
# local package files whose names end in .deb — an extensionless mktemp file
# gets "E: Unsupported file ... given on commandline".
TMP_DIR="$(mktemp -d)"
TMP_DEB="${TMP_DIR}/google-chrome-stable.deb"
trap 'rm -rf "${TMP_DIR}"' EXIT

CHROME_DEB_URL="https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb"
# Prefer wget; fall back to curl. Either can be absent on a stripped-down box —
# the presence check below is the source of truth, so a failed download just
# means the final chrome_ready check reports the real error.
if command -v wget >/dev/null 2>&1; then
  wget -q -O "${TMP_DEB}" "${CHROME_DEB_URL}" || true
elif command -v curl >/dev/null 2>&1; then
  curl -fsSL -o "${TMP_DEB}" "${CHROME_DEB_URL}" || true
else
  echo "ERROR: neither wget nor curl available to download Chrome" >&2
  exit 1
fi

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
