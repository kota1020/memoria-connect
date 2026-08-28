#!/bin/bash
# memoria screen — build the capture helpers and the menu bar app (macOS).
# Requires Xcode Command Line Tools (xcode-select --install).
#
#   ./build.sh                     # ad-hoc build
#   CODESIGN_ID="Developer ID Application: You (TEAM)" ./build.sh
#
# Signing with a real identity is strongly recommended: macOS ties the
# Accessibility / Screen Recording permissions to the binary's signature, so an
# unsigned app silently loses them on every rebuild.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p bin
for n in win axread ocrimg; do
  swiftc -O "helpers/$n.swift" -o "bin/$n"
  echo "built bin/$n"
done

APP=MemoriaScreen.app
mkdir -p "$APP/Contents/MacOS"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>MemoriaScreen</string>
  <key>CFBundleDisplayName</key><string>memoria screen</string>
  <key>CFBundleIdentifier</key><string>com.memoria.screen</string>
  <key>CFBundleExecutable</key><string>menubar</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
</dict></plist>
PLIST
swiftc -O menubar.swift -o "$APP/Contents/MacOS/menubar"
echo "built $APP"

if [ -n "${CODESIGN_ID:-}" ]; then
  codesign --force --options runtime --sign "$CODESIGN_ID" --identifier com.memoria.screen "$APP"
  for n in win axread ocrimg; do codesign --force --sign "$CODESIGN_ID" "bin/$n"; done
  echo "signed with: $CODESIGN_ID"
else
  echo "note: unsigned build — permissions will reset on every rebuild (set CODESIGN_ID to avoid this)"
fi

echo
echo "next: ./install-launchd.sh   (starts at login)"
echo "or run once: open $APP"
echo "grant BOTH permissions in System Settings → Privacy & Security:"
echo "  • Accessibility → MemoriaScreen"
echo "  • Screen & System Audio Recording → MemoriaScreen"
