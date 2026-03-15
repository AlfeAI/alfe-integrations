#!/usr/bin/env bash
PID_FILE="${ALFE_STATE_DIR}/voice-relay.pid"
if [ -f "$PID_FILE" ] && kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
  echo "healthy"
  exit 0
fi
echo "unhealthy: relay not running"
exit 1
