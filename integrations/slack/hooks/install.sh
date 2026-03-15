#!/bin/bash
# Integration install hook
# Called by the agent daemon after the integration is installed.
# The following env vars are available:
#   AGENT_ID — the agent this integration is installed for
#   INTEGRATION_ID — this integration's identifier
#   CONFIG_JSON — JSON string of the user-provided config

echo "Installing ${INTEGRATION_ID} for agent ${AGENT_ID}..."
echo "Installation complete."
exit 0
