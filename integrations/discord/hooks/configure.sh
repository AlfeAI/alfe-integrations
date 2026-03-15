#!/bin/bash
# configure.sh — Apply guild/channel config to the Discord plugin
#
# Environment variables (set by daemon):
#   DISCORD_GUILD_ID    — Connected guild ID
#   DISCORD_CHANNEL_ID  — Default channel ID (optional)
#   ALFE_STATE_DIR      — State directory path

set -euo pipefail

STATE_DIR="${ALFE_STATE_DIR:-$HOME/.alfe/integrations/discord}"

echo "Configuring Discord integration..."

if [ -z "${DISCORD_GUILD_ID:-}" ]; then
  echo "⚠️  No DISCORD_GUILD_ID set — skipping channel config"
  exit 0
fi

# Write config to state
mkdir -p "${STATE_DIR}"
cat > "${STATE_DIR}/config.json" << CONF
{
  "guildId": "${DISCORD_GUILD_ID}",
  "channelId": "${DISCORD_CHANNEL_ID:-}",
  "configuredAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
CONF

echo "✅ Discord configured for guild ${DISCORD_GUILD_ID}"
