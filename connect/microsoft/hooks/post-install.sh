#!/usr/bin/env bash
set -euo pipefail

# Install Microsoft Graph CLI (mgc) if not present.
#
# mgc is NOT distributed on npm — the old `npm install -g
# @microsoft/microsoft-graph-cli` line 404'd on every install (the package
# has never existed in the registry) and made this integration DOA. mgc
# ships as self-contained platform binaries via GitHub releases:
# https://github.com/microsoftgraph/msgraph-cli
MGC_VERSION="1.9.0"

if ! command -v mgc &>/dev/null; then
  echo "Installing Microsoft Graph CLI v${MGC_VERSION}..."
  TMP_TGZ="$(mktemp --suffix=.tar.gz)"
  trap 'rm -f "${TMP_TGZ}"' EXIT
  curl -fsSL -o "${TMP_TGZ}" \
    "https://github.com/microsoftgraph/msgraph-cli/releases/download/v${MGC_VERSION}/msgraph-cli-linux-x64-${MGC_VERSION}.tar.gz"
  # The tarball contains `mgc` (and mgc.pdb) at its root.
  tar -xzf "${TMP_TGZ}" -C /usr/local/bin mgc
  chmod +x /usr/local/bin/mgc
fi

echo "mgc CLI version: $(mgc --version)"
