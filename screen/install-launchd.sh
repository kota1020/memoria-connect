#!/bin/bash
# memoria screen — install the menu bar agent as a login item (launchd).
set -euo pipefail
cd "$(dirname "$0")"
BIN="$(pwd)/MemoriaScreen.app/Contents/MacOS/menubar"
[ -x "$BIN" ] || { echo "run ./build.sh first"; exit 1; }
PLIST="$HOME/Library/LaunchAgents/com.memoria.screen.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.memoria.screen</string>
  <key>ProgramArguments</key><array><string>$BIN</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
EOF
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "installed: $PLIST (👁 should appear in the menu bar)"
