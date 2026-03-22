#!/usr/bin/env bash
PID_FILE="${ALFE_STATE_DIR}/ai-proxy.pid"
if [ -f "$PID_FILE" ]; then
  kill "$(cat "$PID_FILE")" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "AI proxy stopped"
fi
