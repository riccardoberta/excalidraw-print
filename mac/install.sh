#!/bin/bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/excalidraw-print.app"
TARGET_DIR="$HOME/Applications"

# Ad-hoc sign the bundle: without any signature at all, modern macOS
# refuses to launch it via Spotlight/Finder/Dock with a generic "internal
# error" instead of the usual (actionable) Gatekeeper prompt. Signed fresh
# on every install so edits to the launcher script are always covered.
codesign --force --deep --sign - "$APP"

mkdir -p "$TARGET_DIR"
ln -sfn "$APP" "$TARGET_DIR/excalidraw-print.app"

# Make sure Launch Services picks up the (re-)signed bundle immediately.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" >/dev/null 2>&1 || true

echo "Installed: $TARGET_DIR/excalidraw-print.app"
echo "You can now launch it from Spotlight, Launchpad, or Finder > Applications."
echo
echo "Since the app is only ad-hoc signed, the FIRST launch will likely be blocked"
echo "by Gatekeeper ('cannot verify developer'). Right-click the app > Open, then"
echo "confirm — this is only needed once."
