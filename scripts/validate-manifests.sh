#!/usr/bin/env bash
# Validate all alfe-integration.yaml manifests in the repo
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

errors=0

for manifest in "$REPO_ROOT"/integrations/*/alfe-integration.yaml; do
  integration="$(basename "$(dirname "$manifest")")"
  if npx -y js-yaml "$manifest" > /dev/null 2>&1; then
    echo "✅ $integration — valid YAML"
  else
    echo "❌ $integration — invalid YAML"
    errors=$((errors + 1))
  fi
done

if [ "$errors" -gt 0 ]; then
  echo ""
  echo "❌ $errors manifest(s) failed validation"
  exit 1
else
  echo ""
  echo "✅ All manifests valid"
fi
