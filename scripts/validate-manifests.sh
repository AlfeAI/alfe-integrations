#!/usr/bin/env bash
# Validate all alfe-integration.yaml manifests in the repo
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

errors=0

# Keep validation dependency-free and cover every catalogue family. The old
# `npx js-yaml` invocation no longer exposed a compatible CLI and only walked
# the integrations/ directory, so it reported every file as invalid while
# silently skipping Connections and Channels.
validate_yaml() {
  ruby -e '
    require "yaml"
    YAML.safe_load_file(ARGV.fetch(0), permitted_classes: [], permitted_symbols: [], aliases: true)
  ' "$1"
}

while IFS= read -r manifest; do
  integration="$(basename "$(dirname "$manifest")")"
  family="$(basename "$(dirname "$(dirname "$manifest")")")"
  if validate_yaml "$manifest" > /dev/null 2>&1; then
    echo "✅ $family/$integration — valid YAML"
  else
    echo "❌ $family/$integration — invalid YAML"
    errors=$((errors + 1))
  fi
done < <(find "$REPO_ROOT" -mindepth 3 -maxdepth 3 -name alfe-integration.yaml -type f | sort)

if [ "$errors" -gt 0 ]; then
  echo ""
  echo "❌ $errors manifest(s) failed validation"
  exit 1
else
  echo ""
  echo "✅ All manifests valid"
fi
