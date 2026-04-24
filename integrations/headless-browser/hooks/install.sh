#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

# Install Google Chrome (native deb, no snap/AppArmor sandboxing issues)
# Snap Chromium's AppArmor confinement prevents programmatic CDP control.
apt-get update -qq
apt-get install -y -qq wget gnupg2
wget -qO- https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
apt-get update -qq
apt-get install -y -qq google-chrome-stable
