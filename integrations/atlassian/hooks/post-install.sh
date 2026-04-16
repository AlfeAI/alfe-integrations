#!/usr/bin/env bash
# Post-install hook for Atlassian integration.
# Ensures mcp-atlassian is available via uvx (Python package manager).
set -euo pipefail

echo "Checking for mcp-atlassian MCP server..."

if command -v uvx &>/dev/null; then
  echo "uvx found — mcp-atlassian will be installed on first run via uvx"
elif command -v pipx &>/dev/null; then
  echo "Installing mcp-atlassian via pipx..."
  pipx install mcp-atlassian
elif command -v pip &>/dev/null; then
  echo "Installing mcp-atlassian via pip..."
  pip install --user mcp-atlassian
else
  echo "WARNING: No Python package manager found (uvx, pipx, or pip)."
  echo "Install mcp-atlassian manually: pip install mcp-atlassian"
  exit 1
fi

echo "Atlassian MCP server setup complete"
