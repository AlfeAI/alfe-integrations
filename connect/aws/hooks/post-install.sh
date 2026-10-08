#!/usr/bin/env bash
# Install AWS CLI v2 so the agent can run `aws --profile <name> ...` with the
# credential_process profiles post_activate.mjs writes.
#
# Downloads the official zip from awscli.amazonaws.com and verifies its PGP
# signature against AWS's published key (embedded in ../assets) before
# installing. Never installs an unverified archive.
#
# Best effort by design: a host where the CLI cannot be installed must not
# fail the integration install or upgrade. health.sh reports a missing CLI.
set -euo pipefail

MIN_VERSION="2.15.0"
INSTALL_DIR="/usr/local/aws-cli"
BIN_DIR="/usr/local/bin"
# AWS CLI Team <aws-cli@amazon.com>, key A6310ACC4672475C (expires 2027-07-01).
KEY_FINGERPRINT="FB5DB77FD5C118B80511ADA8A6310ACC4672475C"
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_FILE="$HOOK_DIR/../assets/aws-cli-public-key.asc"
STAGE=""
# Preserve the script's own exit status: cleanup must never turn the
# always-exit-0 contract into a failure.
cleanup() {
  local status=$?
  if [ -n "$STAGE" ]; then rm -rf "$STAGE" 2>/dev/null || true; fi
  exit "$status"
}
trap cleanup EXIT

aws_version() {
  # A broken aws must not abort the script (set -e + pipefail): empty means unknown.
  # v1 printed its version on stderr, v2 prints it on stdout.
  { aws --version 2>&1 || true; } | sed -n 's/^aws-cli\/\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' | head -n 1 || true
}

version_ok() {
  [ -n "$1" ] && [ "$(printf '%s\n%s\n' "$MIN_VERSION" "$1" | sort -V | head -n 1)" = "$MIN_VERSION" ]
}

skip() {
  echo "WARNING: $1 Install AWS CLI v2 >= $MIN_VERSION manually (https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) so the agent can use its AWS profiles."
  exit 0
}

if command -v aws >/dev/null 2>&1; then
  current="$(aws_version)"
  if version_ok "$current"; then
    echo "AWS CLI version: $current"
    exit 0
  fi
  echo "AWS CLI ${current:-unknown version} is older than $MIN_VERSION; installing AWS CLI v2"
fi

[ "$(uname -s)" = "Linux" ] || skip "Automatic AWS CLI install is only supported on Linux."
[ "$(id -u)" = "0" ] || skip "Automatic AWS CLI install requires root."
case "$(uname -m)" in
  x86_64 | amd64) ARCH="x86_64" ;;
  aarch64 | arm64) ARCH="aarch64" ;;
  *) skip "Unsupported architecture $(uname -m)." ;;
esac
command -v curl >/dev/null 2>&1 || skip "curl is required to download the AWS CLI."
[ -s "$KEY_FILE" ] || skip "The AWS CLI signing key is missing from the integration."

# Install missing Debian/Ubuntu packages. Refresh package lists only when the
# first attempt fails (a fresh image may have none).
apt_install() {
  command -v apt-get >/dev/null 2>&1 || return 1
  export DEBIAN_FRONTEND=noninteractive
  local apt_opts=(-o DPkg::Lock::Timeout=120 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
  # Some VMs have /tmp at mode 700, which breaks apt's _apt download sandbox
  # (signature verification cannot write its temp files). Only for this
  # scoped install, run the download methods as root instead.
  if [ "$(stat -c '%a' /tmp 2>/dev/null || echo 1777)" != "1777" ]; then
    echo "WARNING: /tmp is not mode 1777; disabling apt's sandbox user for this install"
    apt_opts+=(-o APT::Sandbox::User=root)
  fi
  apt-get "${apt_opts[@]}" install -y --no-install-recommends "$@" && return 0
  apt-get "${apt_opts[@]}" update || true
  apt-get "${apt_opts[@]}" install -y --no-install-recommends "$@"
}

missing=()
command -v unzip >/dev/null 2>&1 || missing+=(unzip)
command -v gpgv >/dev/null 2>&1 || missing+=(gpgv)
if [ "${#missing[@]}" -gt 0 ]; then
  echo "Installing ${missing[*]}..."
  apt_install "${missing[@]}" || skip "Could not install ${missing[*]}."
fi
command -v base64 >/dev/null 2>&1 || skip "base64 (coreutils) is required."

install_aws() {
  # Called as an `if` condition, so errexit is suspended: check every step.
  # Stage beside the install directory (root-only, mode 0700), never in /tmp.
  STAGE="$(mktemp -d /usr/local/.alfe-awscli.XXXXXX)" || return 1
  local zip="$STAGE/awscliv2.zip"
  local url="https://awscli.amazonaws.com/awscli-exe-linux-${ARCH}.zip"

  # Dearmor the embedded key with coreutils only (gpg may be absent; gpgv
  # needs a binary keyring): drop armor headers and the CRC line, decode.
  sed -n '/^-----BEGIN PGP PUBLIC KEY BLOCK-----/,/^-----END PGP PUBLIC KEY BLOCK-----/p' "$KEY_FILE" \
    | sed '1,/^$/d' | grep -v -e '^=' -e '^-----' | base64 -d > "$STAGE/aws-cli.gpg" || return 1

  curl -fsSL --proto '=https' --tlsv1.2 --retry 2 --max-time 300 "$url" -o "$zip" || return 1
  curl -fsSL --proto '=https' --tlsv1.2 --retry 2 --max-time 60 "$url.sig" -o "$zip.sig" || return 1

  # Require a good signature made by the pinned key, not just gpgv's exit status.
  local status
  status="$(gpgv --status-fd 1 --keyring "$STAGE/aws-cli.gpg" "$zip.sig" "$zip" 2>/dev/null)" || {
    echo "AWS CLI signature verification failed"
    return 1
  }
  if ! printf '%s\n' "$status" | grep -q "^\[GNUPG:\] VALIDSIG .*$KEY_FINGERPRINT"; then
    echo "AWS CLI archive is not signed by the AWS CLI key $KEY_FINGERPRINT"
    return 1
  fi
  echo "AWS CLI signature verified"

  unzip -q "$zip" -d "$STAGE" || return 1
  "$STAGE/aws/install" --update --install-dir "$INSTALL_DIR" --bin-dir "$BIN_DIR" || return 1
}

echo "Installing AWS CLI v2 ($ARCH) from awscli.amazonaws.com..."
if ! install_aws; then
  skip "AWS CLI installation failed."
fi
hash -r

installed="$({ "$BIN_DIR/aws" --version 2>&1 || true; } | sed -n 's/^aws-cli\/\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' | head -n 1 || true)"
version_ok "$installed" || skip "Installed AWS CLI (${installed:-unknown}) does not meet $MIN_VERSION."
echo "AWS CLI version: $installed"
if [ "$(command -v aws || true)" != "$BIN_DIR/aws" ]; then
  echo "WARNING: another aws ($(command -v aws || echo none)) precedes $BIN_DIR/aws on PATH"
fi
