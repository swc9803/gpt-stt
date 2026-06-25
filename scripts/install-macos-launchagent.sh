#!/usr/bin/env bash
set -euo pipefail

LABEL="com.user.gpt-stt-local-server"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
START_SCRIPT="$PROJECT_DIR/scripts/start-local-server-background.sh"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_FILE="$PLIST_DIR/$LABEL.plist"
OLD_LABEL="com.user.gpt-stt-tunnel"
OLD_PLIST_FILE="$PLIST_DIR/$OLD_LABEL.plist"

mkdir -p "$PLIST_DIR" "$PROJECT_DIR/.local-server"
chmod +x "$START_SCRIPT"

if launchctl print "gui/$(id -u)/$OLD_LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)" "$OLD_PLIST_FILE" >/dev/null 2>&1 || true
fi

if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)" "$PLIST_FILE" >/dev/null 2>&1 || true
fi

rm -f "$OLD_PLIST_FILE"

cat > "$PLIST_FILE" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$START_SCRIPT</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>$PROJECT_DIR</string>
  <key>StandardOutPath</key>
  <string>$PROJECT_DIR/.local-server/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$PROJECT_DIR/.local-server/launchd.err.log</string>
</dict>
</plist>
PLIST

plutil -lint "$PLIST_FILE" >/dev/null
launchctl bootstrap "gui/$(id -u)" "$PLIST_FILE"
launchctl enable "gui/$(id -u)/$LABEL"

echo "Registered macOS LaunchAgent: $LABEL"
echo "It starts gpt-stt in the background after you log in."
echo "Project: $PROJECT_DIR"
echo "Logs: $PROJECT_DIR/.local-server/launchd.out.log"
