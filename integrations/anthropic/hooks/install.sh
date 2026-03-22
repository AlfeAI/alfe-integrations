#!/usr/bin/env bash
set -euo pipefail

# Env vars injected by daemon (hooks.ts:buildHookEnv):
#   ALFE_ANTHROPIC_MODE — from integration config
#   ALFE_STATE_DIR      — ~/.alfe/state/anthropic/

# Only start proxy for alfe_credits mode
if [ "${ALFE_ANTHROPIC_MODE:-}" != "alfe_credits" ]; then
  exit 0
fi

PROXY_BIN="npx alfe-ai-proxy"
PID_FILE="${ALFE_STATE_DIR}/ai-proxy.pid"

# Reuse existing proxy (shared across anthropic + openai)
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "AI proxy already running (pid $(cat "$PID_FILE"))"
  exit 0
fi

nohup $PROXY_BIN > "${ALFE_STATE_DIR}/ai-proxy.log" 2>&1 &

echo $! > "$PID_FILE"
echo "AI proxy started (pid $!)"
