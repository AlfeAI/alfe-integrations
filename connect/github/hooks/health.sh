#!/usr/bin/env bash
# Health of the shell (gh/git) half of the GitHub integration. LOCAL ONLY:
# no GitHub API call, so a network blip cannot mark the integration errored
# and mask healthy MCP tools.
#
# gh is optional (see post-install.sh): missing or pre-2.40 gh, or a managed
# account the user logged out of gh, is a WARNING with exit 0. Only an
# unreadable ownership ledger fails: the hook can no longer act safely.
set -euo pipefail

MIN_VERSION="2.40.0"

# Same scrubbing as gh-accounts.mjs: an ambient token would mask the stored one.
unset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN GH_HOST
export GH_PROMPT_DISABLED=1 GH_NO_UPDATE_NOTIFIER=1 NO_COLOR=1

if ! command -v gh >/dev/null 2>&1; then
  echo "WARNING: gh CLI not found; shell git access to private GitHub repositories is unavailable"
  exit 0
fi

# A broken gh must not abort the script (set -e + pipefail): empty means unknown.
version="$({ gh --version 2>/dev/null || true; } | sed -n 's/^gh version \([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' | head -n 1 || true)"
if [ -z "$version" ] || [ "$(printf '%s\n%s\n' "$MIN_VERSION" "$version" | sort -V | head -n 1)" != "$MIN_VERSION" ]; then
  echo "WARNING: gh ${version:-unknown version} is older than $MIN_VERSION; shell git credentials are not managed"
  exit 0
fi
echo "gh CLI available: $version"

LEDGER="${HOME}/.alfe/github-cli/owned-accounts.json"
if [ ! -e "$LEDGER" ]; then
  echo "No Alfe-managed GitHub CLI accounts"
  exit 0
fi

# One validated login per line; "invalid" if the ledger cannot be trusted.
logins="$(node -e '
  try {
    const ledger = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    if (ledger.version !== 1 || !Array.isArray(ledger.accounts)) throw new Error();
    const logins = ledger.accounts.map((entry) => entry && entry.login);
    if (!logins.every((login) => typeof login === "string" && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login))) throw new Error();
    process.stdout.write(logins.join("\n"));
  } catch { process.stdout.write("invalid"); }
' "$LEDGER")"

if [ "$logins" = "invalid" ]; then
  echo "ERROR: GitHub CLI ownership ledger is unreadable: $LEDGER"
  exit 1
fi
if [ -z "$logins" ]; then
  echo "No Alfe-managed GitHub CLI accounts"
  exit 0
fi

missing=()
count=0
while IFS= read -r login; do
  count=$((count + 1))
  # Local lookup only; stdout carries the token, so discard it.
  if ! gh auth token --hostname github.com --user "$login" >/dev/null 2>&1; then
    missing+=("$login")
  fi
done <<< "$logins"

if [ "${#missing[@]}" -gt 0 ]; then
  echo "WARNING: Alfe-managed GitHub account(s) missing from gh: ${missing[*]}; the next activation logs them in again"
  exit 0
fi
echo "gh holds credentials for ${count} Alfe-managed GitHub account(s)"
