#!/usr/bin/env bash
set -euo pipefail

LABEL="com.user.gpt-stt-local-server"
PLIST_FILE="$HOME/Library/LaunchAgents/$LABEL.plist"

if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)" "$PLIST_FILE" >/dev/null 2>&1 || true
fi

rm -f "$PLIST_FILE"
echo "Removed macOS LaunchAgent: $LABEL"
