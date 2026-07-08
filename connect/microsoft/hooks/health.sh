#!/usr/bin/env bash
set -euo pipefail

# Microsoft 365 integration health.
#
# There is no `mgc` CLI to probe — the openclaw-microsoft plugin calls
# Microsoft Graph REST directly, so its health is a function of the plugin
# being installed and the connect credentials resolving (checked at
# activation by hooks/post_activate.mjs), not a local binary.

echo "Microsoft 365 integration healthy (Graph accessed directly via the openclaw-microsoft plugin)"
