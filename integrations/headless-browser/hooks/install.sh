#!/usr/bin/env bash
set -euo pipefail

# Install system Chromium — stable path, no version pinning
apt-get update -qq
apt-get install -y -qq chromium-browser
