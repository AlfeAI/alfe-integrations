#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

# Install system Chromium — stable path, no version pinning
apt-get update -qq
apt-get install -y -qq chromium-browser
