#!/usr/bin/env bash

if command -v google-chrome-stable &>/dev/null; then
  echo "healthy"
  exit 0
fi
echo "unhealthy: google-chrome-stable not found"
exit 1
