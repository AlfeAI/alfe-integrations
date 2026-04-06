#!/usr/bin/env bash

if command -v chromium-browser &>/dev/null; then
  echo "healthy"
  exit 0
fi
echo "unhealthy: chromium-browser not found"
exit 1
