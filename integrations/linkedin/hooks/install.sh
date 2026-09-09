#!/usr/bin/env bash
set -euo pipefail

# Installs the private Python extractor environment only. Chrome and its
# authenticated profile remain owned by Alfe's existing browser capability.
exec npx --yes --package=@alfe.ai/openclaw-linkedin@0.1.1 alfe-linkedin setup
