#!/usr/bin/env bash
# Remove only artifacts owned by this integration. User-authored flows,
# ~/.maestro, ~/.mobiledev, app binaries, SDKs, and devices are untouched.
set -euo pipefail

TOOLS_ROOT="${HOME}/.alfe/tools/maestro"
EXPECTED_STATE_ROOT="${HOME}/.alfe/state/maestro"
STATE_ROOT="${ALFE_STATE_DIR:-${EXPECTED_STATE_ROOT}}"

case "${TOOLS_ROOT}" in
  "${HOME}/.alfe/tools/maestro") ;;
  *)
    echo "maestro: refusing to remove unexpected tools path: ${TOOLS_ROOT}" >&2
    exit 1
    ;;
esac

case "${STATE_ROOT}" in
  "${EXPECTED_STATE_ROOT}") ;;
  *)
    echo "maestro: refusing to remove unexpected state path: ${STATE_ROOT}" >&2
    exit 1
    ;;
esac

rm -rf -- "${TOOLS_ROOT}"
rm -f -- "${STATE_ROOT}/cloud-project-id" "${STATE_ROOT}/cloud-project-id.tmp"
echo "maestro: removed Alfe-managed Maestro files; user projects and device tooling were preserved"
