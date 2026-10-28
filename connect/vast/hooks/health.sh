#!/usr/bin/env bash
# Health of the Vast GPU capability. LOCAL ONLY: no Alfe or Vast API call, so
# a network blip or an empty Vast balance never marks the integration errored.
#
# Fails when the alfe CLI is missing or predates `alfe gpu` (probed with
# `alfe gpu --help`, which needs no config and makes no API call, and must
# print a `Usage: alfe gpu` line). Missing
# OpenSSH client tools are a WARNING: launch needs ssh-keygen and the agent
# needs ssh/scp to use an instance, but nothing is broken until it tries.
set -euo pipefail

if ! command -v alfe >/dev/null 2>&1; then
  echo "ERROR: alfe CLI not found on PATH; GPU instances cannot be used until it is installed"
  exit 1
fi
# The exit code alone proves nothing: on a CLI without `gpu`, commander prints
# the ROOT help for `alfe gpu --help` and exits 0. Require the subcommand's
# own usage line. Pure bash matching: no grep dependency.
help="$(alfe gpu --help 2>/dev/null || true)"
if [[ $'\n'"$help" != *$'\n''Usage: alfe gpu '* ]]; then
  echo "ERROR: this alfe CLI predates \`alfe gpu\`; update the Alfe CLI to use GPU instances"
  exit 1
fi
echo "alfe gpu is available"

missing=()
for tool in ssh scp ssh-keygen; do
  command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "WARNING: OpenSSH client tools missing: ${missing[*]}; install openssh-client to connect to GPU instances"
fi
