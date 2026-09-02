#!/usr/bin/env bash
# Install a checksum-pinned Maestro CLI distribution into Alfe-owned state.
#
# We intentionally do not execute Maestro's remote `curl | bash` installer:
# the integration needs a reproducible artifact, must not edit shell profiles,
# and must be able to remove only the files it owns. If Java 17+ is not already
# usable, a checksum-pinned Temurin JRE is installed beside Maestro.
set -euo pipefail

MAESTRO_VERSION="2.10.0"
MAESTRO_ARCHIVE_URL="https://github.com/mobile-dev-inc/Maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip"
MAESTRO_ARCHIVE_SHA256="29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991"

TEMURIN_VERSION="17.0.20.1+1"
TEMURIN_RELEASE_TAG="jdk-17.0.20.1%2B1"

TOOLS_ROOT="${HOME}/.alfe/tools/maestro"
VERSIONS_ROOT="${TOOLS_ROOT}/versions"
MAESTRO_VERSION_DIR="${VERSIONS_ROOT}/${MAESTRO_VERSION}"
JRE_ROOT="${TOOLS_ROOT}/jre"
BIN_ROOT="${TOOLS_ROOT}/bin"
MIN_INSTALL_FREE_KB=1000000

fail() {
  echo "maestro: $*" >&2
  exit 1
}

download_file() {
  local source_url="$1"
  local destination="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 --retry-delay 2 -o "${destination}" "${source_url}"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "${destination}" "${source_url}"
  else
    fail "curl or wget is required to download Maestro"
  fi
}

sha256_file() {
  local archive="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${archive}" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${archive}" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "${archive}" | awk '{print $NF}'
  else
    fail "sha256sum, shasum, or openssl is required to verify downloads"
  fi
}

verify_sha256() {
  local archive="$1"
  local expected="$2"
  local actual
  actual="$(sha256_file "${archive}")"
  if [ "${actual}" != "${expected}" ]; then
    fail "checksum mismatch for $(basename "${archive}")"
  fi
}

java_major() {
  local java_bin="$1"
  "${java_bin}" -version 2>&1 | awk -F'[\".]' '/version/ { if ($2 == "1") print $3; else print $2; exit }'
}

system_java_17() {
  local candidate=""
  local major=""

  if [ -n "${JAVA_HOME:-}" ] && [ -x "${JAVA_HOME}/bin/java" ]; then
    candidate="${JAVA_HOME}/bin/java"
  elif command -v java >/dev/null 2>&1; then
    candidate="$(command -v java)"
  fi

  [ -n "${candidate}" ] || return 1
  major="$(java_major "${candidate}" || true)"
  [ -n "${major}" ] && [ "${major}" -ge 17 ] 2>/dev/null
}

ensure_install_space() {
  local available_kb

  # A clean Linux/arm64 container install peaks below this fence while the
  # 315 MB Maestro archive, extracted distribution, and optional Temurin JRE
  # coexist. Keep a little headroom for an existing version during upgrades.
  available_kb="$(df -Pk "${TOOLS_ROOT}" | awk 'NR == 2 { print $4 }')"
  [ -n "${available_kb}" ] || fail "could not determine free disk space"
  if [ "${available_kb}" -lt "${MIN_INSTALL_FREE_KB}" ] 2>/dev/null; then
    fail "at least 1 GB of free disk space is required to install Maestro"
  fi
}

select_temurin_asset() {
  local operating_system
  local machine_arch
  local asset_name
  local asset_sha

  operating_system="$(uname -s)"
  machine_arch="$(uname -m)"

  case "${operating_system}:${machine_arch}" in
    Linux:x86_64|Linux:amd64)
      asset_name="OpenJDK17U-jre_x64_linux_hotspot_17.0.20.1_1.tar.gz"
      asset_sha="0b2b640e3046b64c8ec504de0ab9d91bb5610182bda21fad454681ce54d45a62"
      ;;
    Linux:aarch64|Linux:arm64)
      asset_name="OpenJDK17U-jre_aarch64_linux_hotspot_17.0.20.1_1.tar.gz"
      asset_sha="b8efcd5acc9109fe8d35bed132499643048a257b4f6042906ece37d03c839d77"
      ;;
    Darwin:x86_64|Darwin:amd64)
      asset_name="OpenJDK17U-jre_x64_mac_hotspot_17.0.20.1_1.tar.gz"
      asset_sha="333cb81123c36568586646c73c8fa2326dab8badc43f5ea388a90fff59c9df27"
      ;;
    Darwin:arm64|Darwin:aarch64)
      asset_name="OpenJDK17U-jre_aarch64_mac_hotspot_17.0.20.1_1.tar.gz"
      asset_sha="190480874ccceb358cbc840393207f77ac3e63a4c5f8129d0e23e9518b96ad05"
      ;;
    *)
      fail "automatic Java installation is unsupported on ${operating_system}/${machine_arch}; install Java 17+ and retry"
      ;;
  esac

  printf '%s\n%s\n' "${asset_name}" "${asset_sha}"
}

install_temurin() {
  local temp_root="$1"
  local asset_details
  local asset_name
  local asset_sha
  local asset_url
  local archive
  local extract_root
  local extracted_dir
  local target_dir="${JRE_ROOT}/${TEMURIN_VERSION}"

  if [ -x "${target_dir}/bin/java" ] || [ -x "${target_dir}/Contents/Home/bin/java" ]; then
    return 0
  fi

  command -v tar >/dev/null 2>&1 || fail "tar is required to install the bundled Java runtime"
  asset_details="$(select_temurin_asset)"
  asset_name="$(printf '%s\n' "${asset_details}" | sed -n '1p')"
  asset_sha="$(printf '%s\n' "${asset_details}" | sed -n '2p')"
  asset_url="https://github.com/adoptium/temurin17-binaries/releases/download/${TEMURIN_RELEASE_TAG}/${asset_name}"
  archive="${temp_root}/${asset_name}"
  extract_root="${temp_root}/temurin"

  echo "maestro: installing private Eclipse Temurin ${TEMURIN_VERSION} runtime"
  download_file "${asset_url}" "${archive}"
  verify_sha256 "${archive}" "${asset_sha}"
  mkdir -p "${extract_root}" "${JRE_ROOT}"
  tar -xzf "${archive}" -C "${extract_root}"

  extracted_dir="$(find "${extract_root}" -mindepth 1 -maxdepth 1 -type d -print | head -n 1)"
  [ -n "${extracted_dir}" ] || fail "Temurin archive did not contain a runtime directory"
  rm -rf -- "${target_dir}"
  mv "${extracted_dir}" "${target_dir}"

  if [ -x "${target_dir}/bin/java" ]; then
    [ "$(java_major "${target_dir}/bin/java")" -ge 17 ] 2>/dev/null || fail "bundled Temurin runtime is invalid"
  elif [ -x "${target_dir}/Contents/Home/bin/java" ]; then
    [ "$(java_major "${target_dir}/Contents/Home/bin/java")" -ge 17 ] 2>/dev/null || fail "bundled Temurin runtime is invalid"
  else
    fail "Temurin archive did not contain a Java executable"
  fi
}

extract_maestro() {
  local archive="$1"
  local destination="$2"

  if command -v unzip >/dev/null 2>&1; then
    unzip -q "${archive}" -d "${destination}"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m zipfile -e "${archive}" "${destination}"
  else
    fail "unzip or python3 is required to extract Maestro"
  fi
}

install_maestro() {
  local temp_root="$1"
  local archive="${temp_root}/maestro.zip"
  local extract_root="${temp_root}/maestro-extract"
  local extracted_dir="${extract_root}/maestro"

  if [ -x "${MAESTRO_VERSION_DIR}/bin/maestro" ]; then
    return 0
  fi

  echo "maestro: installing Maestro CLI ${MAESTRO_VERSION}"
  download_file "${MAESTRO_ARCHIVE_URL}" "${archive}"
  verify_sha256 "${archive}" "${MAESTRO_ARCHIVE_SHA256}"
  mkdir -p "${extract_root}" "${VERSIONS_ROOT}"
  extract_maestro "${archive}" "${extract_root}"
  [ -x "${extracted_dir}/bin/maestro" ] || fail "Maestro archive did not contain maestro/bin/maestro"

  rm -rf -- "${MAESTRO_VERSION_DIR}"
  mv "${extracted_dir}" "${MAESTRO_VERSION_DIR}"
}

write_launchers() {
  local launcher_tmp="${BIN_ROOT}/.alfe-maestro.tmp"
  local mcp_launcher_tmp="${BIN_ROOT}/.alfe-maestro-mcp.tmp"

  mkdir -p "${BIN_ROOT}"
  cat > "${launcher_tmp}" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail

TOOLS_ROOT="${HOME}/.alfe/tools/maestro"
MAESTRO_BIN="${TOOLS_ROOT}/current/bin/maestro"
JAVA_BIN=""

# Keep the MCP stdio channel and CLI version probes free of Maestro's optional
# analytics and feature-announcement banners.
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

java_major() {
  "$1" -version 2>&1 | awk -F'[\".]' '/version/ { if ($2 == "1") print $3; else print $2; exit }'
}

use_java_home() {
  local candidate_home="$1"
  local candidate_java="${candidate_home}/bin/java"
  local major=""
  [ -x "${candidate_java}" ] || return 1
  major="$(java_major "${candidate_java}" || true)"
  [ -n "${major}" ] && [ "${major}" -ge 17 ] 2>/dev/null || return 1
  JAVA_HOME="${candidate_home}"
  JAVA_BIN="${candidate_java}"
  export JAVA_HOME
}

[ -x "${MAESTRO_BIN}" ] || {
  echo "maestro: managed CLI is missing; reinstall the Maestro Testing integration" >&2
  exit 1
}

if ! use_java_home "${TOOLS_ROOT}/jre/current"; then
  if ! use_java_home "${TOOLS_ROOT}/jre/current/Contents/Home"; then
    if [ -n "${JAVA_HOME:-}" ] && use_java_home "${JAVA_HOME}"; then
      :
    elif command -v java >/dev/null 2>&1; then
      JAVA_BIN="$(command -v java)"
      JAVA_MAJOR="$(java_major "${JAVA_BIN}" || true)"
      if [ -z "${JAVA_MAJOR}" ] || [ "${JAVA_MAJOR}" -lt 17 ] 2>/dev/null; then
        echo "maestro: Java 17+ is required; reinstall the Maestro Testing integration" >&2
        exit 1
      fi
      unset JAVA_HOME
    else
      echo "maestro: Java 17+ is required; reinstall the Maestro Testing integration" >&2
      exit 1
    fi
  fi
fi

if [ -n "${JAVA_HOME:-}" ]; then
  export PATH="${JAVA_HOME}/bin:${PATH}"
fi
exec "${MAESTRO_BIN}" "$@"
LAUNCHER

  cat > "${mcp_launcher_tmp}" <<'MCP_LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail

WORKING_DIR="${MAESTRO_WORKING_DIR:-${HOME}/.openclaw/workspace}"
if [ ! -d "${WORKING_DIR}" ]; then
  WORKING_DIR="${HOME}"
fi

exec "${HOME}/.alfe/tools/maestro/bin/alfe-maestro" mcp --working-dir "${WORKING_DIR}" "$@"
MCP_LAUNCHER

  chmod 0755 "${launcher_tmp}" "${mcp_launcher_tmp}"
  mv -f "${launcher_tmp}" "${BIN_ROOT}/alfe-maestro"
  mv -f "${mcp_launcher_tmp}" "${BIN_ROOT}/alfe-maestro-mcp"
}

atomic_symlink() {
  local target="$1"
  local link_path="$2"
  local next_link="${link_path}.next"

  if [ -e "${link_path}" ] && [ ! -L "${link_path}" ]; then
    fail "refusing to replace non-symlink path ${link_path}"
  fi
  rm -f -- "${next_link}"
  ln -s "${target}" "${next_link}"
  mv -f "${next_link}" "${link_path}"
}

staged_maestro_version() {
  local maestro_root="$1"
  local java_home=""
  local major=""

  if [ -x "${JRE_ROOT}/current/bin/java" ]; then
    java_home="${JRE_ROOT}/current"
  elif [ -x "${JRE_ROOT}/current/Contents/Home/bin/java" ]; then
    java_home="${JRE_ROOT}/current/Contents/Home"
  elif [ -n "${JAVA_HOME:-}" ] && [ -x "${JAVA_HOME}/bin/java" ]; then
    major="$(java_major "${JAVA_HOME}/bin/java" || true)"
    if [ -n "${major}" ] && [ "${major}" -ge 17 ] 2>/dev/null; then
      java_home="${JAVA_HOME}"
    fi
  fi

  if [ -n "${java_home}" ]; then
    MAESTRO_CLI_NO_ANALYTICS=1 \
      MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true \
      JAVA_HOME="${java_home}" PATH="${java_home}/bin:${PATH}" \
      "${maestro_root}/bin/maestro" --version 2>/dev/null
  else
    env -u JAVA_HOME \
      MAESTRO_CLI_NO_ANALYTICS=1 \
      MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true \
      "${maestro_root}/bin/maestro" --version 2>/dev/null
  fi
}

validate_staged_maestro() {
  local installed_version=""

  if ! installed_version="$(staged_maestro_version "${MAESTRO_VERSION_DIR}")"; then
    echo "maestro: staged Maestro CLI or Java 17+ is unavailable" >&2
    return 1
  fi
  if [ "${installed_version}" != "${MAESTRO_VERSION}" ]; then
    echo "maestro: expected staged Maestro ${MAESTRO_VERSION}, got ${installed_version:-unknown}" >&2
    return 1
  fi
}

activate_maestro_version() {
  # Keep the existing current target usable until every fallible staging step
  # has succeeded. The symlink replacement is the final commit point.
  validate_staged_maestro || return 1
  write_launchers
  "${ALFE_INTEGRATION_DIR}/hooks/configure.sh"
  atomic_symlink "${MAESTRO_VERSION_DIR}" "${TOOLS_ROOT}/current"
}

main() {
  mkdir -p "${TOOLS_ROOT}" "${VERSIONS_ROOT}" "${JRE_ROOT}" "${BIN_ROOT}"
  chmod 0700 "${TOOLS_ROOT}"
  ensure_install_space

  TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/alfe-maestro.XXXXXX")"
  trap 'rm -rf -- "${TEMP_ROOT}"' EXIT

  if ! system_java_17; then
    install_temurin "${TEMP_ROOT}"
    atomic_symlink "${JRE_ROOT}/${TEMURIN_VERSION}" "${JRE_ROOT}/current"
  fi

  install_maestro "${TEMP_ROOT}"
  activate_maestro_version

  echo "maestro: Maestro CLI ${MAESTRO_VERSION} is ready at ${BIN_ROOT}/alfe-maestro"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
