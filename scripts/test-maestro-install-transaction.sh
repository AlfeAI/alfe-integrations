#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/alfe-maestro-install-test.XXXXXX")"
trap 'rm -rf -- "${TEST_ROOT}"' EXIT

export HOME="${TEST_ROOT}/home"
export ALFE_INTEGRATION_DIR="${REPO_ROOT}/integrations/maestro"

# The source path is resolved from this checked-in repository root.
# shellcheck disable=SC1091
source "${ALFE_INTEGRATION_DIR}/hooks/install.sh"

previous_dir="${TOOLS_ROOT}/versions/2.9.0"
mkdir -p "${previous_dir}/bin" "${MAESTRO_VERSION_DIR}/bin"

cat > "${previous_dir}/bin/maestro" <<'PREVIOUS'
#!/usr/bin/env bash
printf '%s\n' '2.9.0'
PREVIOUS
cat > "${MAESTRO_VERSION_DIR}/bin/maestro" <<'BROKEN_STAGE'
#!/usr/bin/env bash
printf '%s\n' 'post-extraction failure' >&2
exit 42
BROKEN_STAGE
chmod 0755 "${previous_dir}/bin/maestro" "${MAESTRO_VERSION_DIR}/bin/maestro"
ln -s "${previous_dir}" "${TOOLS_ROOT}/current"

if activate_maestro_version; then
  echo "expected staged Maestro validation to fail" >&2
  exit 1
fi

[ "$(readlink "${TOOLS_ROOT}/current")" = "${previous_dir}" ]
[ "$("${TOOLS_ROOT}/current/bin/maestro" --version)" = "2.9.0" ]

echo "maestro install transaction test passed"
