#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

# Pin to OpenClaw's bundled playwright-core version. Source of truth:
# openclaw/extensions/browser/package.json → "playwright-core": "1.59.1"
PLAYWRIGHT_VERSION="1.59.1"

# 1. Install Google Chrome stable — required by OpenClaw's browser plugin.
# Config expects the binary at /usr/bin/google-chrome-stable.
if ! command -v google-chrome-stable &>/dev/null; then
  wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y /tmp/google-chrome.deb || apt-get install -fy
  rm -f /tmp/google-chrome.deb
fi

# 2. Install playwright globally at the pinned version (idempotent).
# `npx playwright install` ad-hoc-fetches and then bails when no `playwright`
# package is resolvable in cwd, so we install it explicitly first.
INSTALLED_VERSION="$(npm ls -g --depth=0 --json 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).dependencies?.playwright?.version??"")}catch{process.stdout.write("")}})')"
if [ "${INSTALLED_VERSION}" != "${PLAYWRIGHT_VERSION}" ]; then
  npm install -g "playwright@${PLAYWRIGHT_VERSION}"
fi

# 3. Install chromium browser binaries + system dependencies.
# Call playwright directly (now on PATH) instead of `npx playwright`.
playwright install chromium
playwright install-deps chromium
