#!/bin/bash
# Integration uninstall hook
# Called by the agent daemon when the integration is removed.
# Available env vars: AGENT_ID, INTEGRATION_ID

echo "Uninstalling ${INTEGRATION_ID} for agent ${AGENT_ID}..."
echo "Uninstallation complete."
exit 0
