#!/bin/bash
# configure.sh — Apply phone number config to the mobile plugin
set -e

PHONE_NUMBER="${ALFE_CONFIG_PHONE_NUMBER:-}"
AGENT_ID="${ALFE_AGENT_ID:-}"
STATE_DIR="${ALFE_STATE_DIR:-$HOME/.alfe/integrations/mobile}"

echo "[integration-mobile] Configuring mobile integration..."
echo "  Phone Number: ${PHONE_NUMBER:-not set}"
echo "  Agent ID: ${AGENT_ID:-not set}"

mkdir -p "$STATE_DIR"

cat > "$STATE_DIR/config.json" << CONFIGEOF
{
  "phoneNumber": "${PHONE_NUMBER}",
  "agentId": "${AGENT_ID}",
  "configuredAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
CONFIGEOF

echo "[integration-mobile] ✅ Configuration saved to $STATE_DIR/config.json"
