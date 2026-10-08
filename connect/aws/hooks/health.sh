#!/usr/bin/env bash
# Health of the AWS integration. LOCAL ONLY: no AWS or Alfe API call, so a
# network blip cannot mark the integration errored.
#
# Fails when the AWS CLI is missing or broken (it is the whole integration),
# when the alfe CLI that every profile's credential_process runs is missing or
# predates `alfe aws` (probed locally with `alfe aws --help`), when the alfe
# managed block in ~/.aws/config is malformed, or when the ownership record is
# unreadable. Everything else is a WARNING with exit 0.
set -euo pipefail

MIN_VERSION="2.15.0"
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: AWS CLI not found; install AWS CLI v2 >= $MIN_VERSION"
  exit 1
fi
# A broken aws must not abort the script (set -e + pipefail): empty means unknown.
version="$({ aws --version 2>&1 || true; } | sed -n 's/^aws-cli\/\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' | head -n 1 || true)"
if [ -z "$version" ]; then
  echo "ERROR: aws --version failed; reinstall AWS CLI v2 >= $MIN_VERSION"
  exit 1
fi
if [ "$(printf '%s\n%s\n' "$MIN_VERSION" "$version" | sort -V | head -n 1)" != "$MIN_VERSION" ]; then
  echo "WARNING: AWS CLI $version is older than $MIN_VERSION"
else
  echo "AWS CLI available: $version"
fi

node --input-type=module -e '
  const { pathToFileURL } = await import("node:url");
  const { homedir } = await import("node:os");
  const { checkAlfeCli, checkHealth } = await import(pathToFileURL(process.argv[1]).href);
  const cli = checkAlfeCli();
  if (!cli.ok) console.log("ERROR: " + cli.message + "; AWS profiles cannot work until it does");
  const result = checkHealth({ home: homedir() });
  for (const message of result.messages) console.log(message);
  process.exitCode = cli.ok && result.ok ? 0 : 1;
' "$HOOK_DIR/aws-profiles.mjs"
