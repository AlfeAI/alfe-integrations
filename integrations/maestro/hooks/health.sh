#!/usr/bin/env bash
set -euo pipefail

MAESTRO="${HOME}/.alfe/tools/maestro/bin/alfe-maestro"
MCP_LAUNCHER="${HOME}/.alfe/tools/maestro/bin/alfe-maestro-mcp"
VERSION_TIMEOUT_SECONDS=12
MCP_STARTUP_SECONDS=4
GROUP_STOP_SECONDS=3

PROBE_ROOT=""
ACTIVE_PID=""

group_alive() {
  [ -n "${ACTIVE_PID}" ] && kill -0 -- "-${ACTIVE_PID}" 2>/dev/null
}

stop_active_group() {
  local waited=0

  [ -n "${ACTIVE_PID}" ] || return 0
  if group_alive; then
    kill -TERM -- "-${ACTIVE_PID}" 2>/dev/null || true
    while group_alive && [ "${waited}" -lt "${GROUP_STOP_SECONDS}" ]; do
      sleep 1
      waited=$((waited + 1))
    done
    if group_alive; then
      kill -KILL -- "-${ACTIVE_PID}" 2>/dev/null || true
    fi
  fi
  wait "${ACTIVE_PID}" 2>/dev/null || true
  ACTIVE_PID=""
}

cleanup() {
  exec 3>&- 2>/dev/null || true
  stop_active_group
  if [ -n "${PROBE_ROOT}" ]; then
    rm -rf -- "${PROBE_ROOT}"
  fi
}
trap cleanup EXIT

[ -x "${MAESTRO}" ] || {
  echo "unhealthy: managed Maestro launcher is missing"
  exit 1
}
[ -x "${MCP_LAUNCHER}" ] || {
  echo "unhealthy: managed Maestro MCP launcher is missing"
  exit 1
}

PROBE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/alfe-maestro-health.XXXXXX")"
VERSION_OUTPUT="${PROBE_ROOT}/version"

# Job control gives each background probe its own process group on both Linux
# and macOS. This lets cleanup terminate the launcher and every JVM descendant.
set -m
"${MAESTRO}" --version > "${VERSION_OUTPUT}" 2>/dev/null &
ACTIVE_PID="$!"
set +m

WAITED=0
while kill -0 "${ACTIVE_PID}" 2>/dev/null; do
  if [ "${WAITED}" -ge "${VERSION_TIMEOUT_SECONDS}" ]; then
    echo "unhealthy: Maestro version probe exceeded ${VERSION_TIMEOUT_SECONDS}s"
    exit 1
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

if ! wait "${ACTIVE_PID}" 2>/dev/null; then
  echo "unhealthy: Maestro CLI or Java 17+ is unavailable"
  exit 1
fi
stop_active_group
VERSION="$(cat "${VERSION_OUTPUT}")"

PROBE_INPUT="${PROBE_ROOT}/stdin"
mkfifo "${PROBE_INPUT}"
exec 3<> "${PROBE_INPUT}"
set -m
"${MCP_LAUNCHER}" --no-viewer < "${PROBE_INPUT}" > "${PROBE_ROOT}/stdout" 2> "${PROBE_ROOT}/stderr" &
ACTIVE_PID="$!"
set +m
sleep "${MCP_STARTUP_SECONDS}"

if ! kill -0 "${ACTIVE_PID}" 2>/dev/null || ! group_alive; then
  echo "unhealthy: Maestro MCP server did not remain running"
  exit 1
fi

echo "healthy: Maestro ${VERSION} and its MCP server are installed"
