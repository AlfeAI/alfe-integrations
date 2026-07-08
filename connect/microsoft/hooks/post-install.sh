#!/usr/bin/env bash
set -euo pipefail

# Microsoft 365 integration — nothing to install at the OS level.
#
# The `@alfe.ai/openclaw-microsoft` plugin talks to graph.microsoft.com REST
# directly (see hooks/post_activate.mjs for why `mgc` can't be used for
# non-interactive delegated auth), so there is NO CLI binary to fetch. The
# plugin itself is installed by the daemon from the manifest's
# `installs.runtimes.openclaw.plugins` list via `npx -y`.
#
# This hook is intentionally a no-op. (The previous version downloaded the
# Microsoft Graph CLI `mgc` binary, which the plugin never invokes.)

echo "Microsoft 365 integration: no OS-level install required (plugin uses Microsoft Graph REST directly)"
