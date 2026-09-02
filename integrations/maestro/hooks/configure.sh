#!/usr/bin/env bash
# Persist only the optional, non-secret Cloud project id for the agent skill.
# The API key is intentionally never written to disk; it is injected directly
# into the MCP child process by the integration runtime.
set -euo pipefail

EXPECTED_STATE_ROOT="${HOME}/.alfe/state/maestro"
STATE_ROOT="${ALFE_STATE_DIR:-${EXPECTED_STATE_ROOT}}"
PROJECT_FILE="${STATE_ROOT}/cloud-project-id"
PROJECT_ID="${ALFE_MAESTRO_MAESTRO_CLOUD_PROJECT_ID:-}"

case "${STATE_ROOT}" in
  "${EXPECTED_STATE_ROOT}") ;;
  *)
    echo "maestro: refusing to write unexpected state path: ${STATE_ROOT}" >&2
    exit 1
    ;;
esac

mkdir -p "${STATE_ROOT}"
chmod 0700 "${STATE_ROOT}"

if [ -n "${PROJECT_ID}" ]; then
  umask 077
  printf '%s\n' "${PROJECT_ID}" > "${PROJECT_FILE}.tmp"
  mv -f "${PROJECT_FILE}.tmp" "${PROJECT_FILE}"
else
  rm -f -- "${PROJECT_FILE}" "${PROJECT_FILE}.tmp"
fi
