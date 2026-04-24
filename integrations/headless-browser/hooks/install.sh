#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

# Install Playwright Chromium + system dependencies.
# OpenClaw's browser plugin uses Playwright internally, so we need
# Playwright's bundled Chromium in ~/.cache/ms-playwright/.
npx playwright install chromium
npx playwright install-deps chromium
