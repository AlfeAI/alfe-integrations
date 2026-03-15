#!/usr/bin/env bash
# integration-sync configure hook
# Applies sync configuration (scope, schedule) to the local daemon state.
set -euo pipefail

STATE_DIR="${ALFE_STATE_DIR:-$HOME/.alfe/integrations/sync}"
mkdir -p "$STATE_DIR"

# Write config from environment (set by the integrations service)
cat > "$STATE_DIR/config.json" << JSONEOF
{
  "sync_scope": ${SYNC_SCOPE:-'["config","conversations","memory"]'},
  "sync_schedule": "${SYNC_SCHEDULE:-daily}",
  "configured_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSONEOF

echo "✅ Sync configuration saved to $STATE_DIR/config.json"
