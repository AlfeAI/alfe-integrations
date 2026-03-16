#!/usr/bin/env bash
set -euo pipefail

# Config injected as env vars by daemon:
# ALFE_VOICE_TWILIO_ACCOUNT_SID, ALFE_VOICE_PHONE_NUMBER, ALFE_VOICE_RELAY_URL

RELAY_BIN="${ALFE_INTEGRATION_DIR}/node_modules/@alfe.ai/openclaw-voice/bin/relay"
PID_FILE="${ALFE_STATE_DIR}/voice-relay.pid"

if [ -f "$PID_FILE" ] && kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
  echo "Voice relay already running (pid $(cat $PID_FILE))"
  exit 0
fi

nohup "$RELAY_BIN" \
  --account-sid "$ALFE_VOICE_TWILIO_ACCOUNT_SID" \
  --phone "$ALFE_VOICE_PHONE_NUMBER" \
  --relay-url "${ALFE_VOICE_RELAY_URL:-wss://voice.alfe.ai}" \
  > "${ALFE_STATE_DIR}/voice-relay.log" 2>&1 &

echo $! > "$PID_FILE"
echo "Voice relay started (pid $!)"
