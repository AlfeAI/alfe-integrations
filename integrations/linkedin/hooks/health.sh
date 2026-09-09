#!/usr/bin/env bash
set -euo pipefail

# Never access LinkedIn or start a browser during health checks. Reuse the
# exact package cached by setup without introducing a network dependency.
exec npx --offline --yes --package=@alfe.ai/openclaw-linkedin@0.1.1 alfe-linkedin health
