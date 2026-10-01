#!/usr/bin/env bash
# Install the GitHub CLI (gh) so shell git/gh can use the agent's connected
# GitHub accounts (credentials are written by post_activate.mjs).
#
# Best effort by design: GitHub MCP tools do not need gh, so a host where gh
# cannot be installed must not fail the integration install or upgrade.
# post_activate skips (and logs) when gh is missing or too old.
set -euo pipefail

MIN_VERSION="2.40.0"
KEYRING_DIR="/etc/apt/keyrings"
KEYRING="$KEYRING_DIR/githubcli-archive-keyring.gpg"
SOURCES="/etc/apt/sources.list.d/github-cli.list"
STAGED_KEYRING="$KEYRING.$$.tmp"
STAGED_SOURCES="$SOURCES.$$.tmp"
# Preserve the script's own exit status: cleanup must never turn the
# always-exit-0 contract into a failure.
cleanup() {
  local status=$?
  rm -f "$STAGED_KEYRING" "$STAGED_SOURCES" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT

gh_version() {
  # A broken gh must not abort the script (set -e + pipefail): empty means unknown.
  { gh --version 2>/dev/null || true; } | sed -n 's/^gh version \([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' | head -n 1 || true
}

version_ok() {
  [ -n "$1" ] && [ "$(printf '%s\n%s\n' "$MIN_VERSION" "$1" | sort -V | head -n 1)" = "$MIN_VERSION" ]
}

skip() {
  echo "WARNING: $1 Install GitHub CLI >= $MIN_VERSION manually (https://cli.github.com) for shell git access; GitHub MCP tools are unaffected."
  exit 0
}

if command -v gh >/dev/null 2>&1; then
  current="$(gh_version)"
  if version_ok "$current"; then
    echo "gh CLI version: $current"
    exit 0
  fi
  echo "gh ${current:-unknown version} is older than $MIN_VERSION; upgrading"
fi

[ "$(uname -s)" = "Linux" ] || skip "Automatic gh install is only supported on Debian/Ubuntu Linux."
[ "$(id -u)" = "0" ] || skip "Automatic gh install requires root."
if ! command -v apt-get >/dev/null 2>&1 || ! command -v dpkg >/dev/null 2>&1; then
  skip "apt-get is not available on this host."
fi
command -v curl >/dev/null 2>&1 || skip "curl is required to fetch the GitHub CLI signing key."

install_gh() {
  export DEBIAN_FRONTEND=noninteractive
  local apt_opts=(-o DPkg::Lock::Timeout=120 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
  # Some VMs have /tmp at mode 700, which breaks apt's _apt download sandbox
  # (signature verification cannot write its temp files). Only for this
  # scoped install, run the download methods as root instead.
  if [ "$(stat -c '%a' /tmp 2>/dev/null || echo 1777)" != "1777" ]; then
    echo "WARNING: /tmp is not mode 1777; disabling apt's sandbox user for the gh install"
    apt_opts+=(-o APT::Sandbox::User=root)
  fi

  # Called as an `if` condition, so errexit is suspended: check every step.
  install -d -m 0755 "$KEYRING_DIR" || return 1
  # Stage beside the destination (not in /tmp) and replace atomically.
  local staged="$STAGED_KEYRING"
  curl -fsSL --proto '=https' --tlsv1.2 --max-time 60 \
    https://cli.github.com/packages/githubcli-archive-keyring.gpg -o "$staged" || return 1
  [ -s "$staged" ] || { echo "Downloaded GitHub CLI keyring is empty"; return 1; }
  chmod 0644 "$staged" && mv -f "$staged" "$KEYRING" || return 1

  printf 'deb [arch=%s signed-by=%s] https://cli.github.com/packages stable main\n' \
    "$(dpkg --print-architecture)" "$KEYRING" > "$STAGED_SOURCES" || return 1
  chmod 0644 "$STAGED_SOURCES" && mv -f "$STAGED_SOURCES" "$SOURCES" || return 1

  # Refresh ONLY the GitHub CLI source so an unrelated broken repository on
  # the host cannot block this install.
  apt-get "${apt_opts[@]}" update \
    -o Dir::Etc::sourcelist="$SOURCES" -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0 || return 1
  apt-get "${apt_opts[@]}" install -y --no-install-recommends gh || return 1
}

echo "Installing GitHub CLI from the official apt repository..."
if ! install_gh; then
  skip "GitHub CLI installation failed."
fi

installed="$(gh_version)"
version_ok "$installed" || skip "Installed gh (${installed:-unknown}) does not meet $MIN_VERSION."
echo "gh CLI version: $installed"
