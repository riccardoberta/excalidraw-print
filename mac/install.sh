#!/bin/bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$HOME/Applications"

mkdir -p "$TARGET_DIR"
ln -sfn "$DIR/excalidraw-print.app" "$TARGET_DIR/excalidraw-print.app"

echo "Installed: $TARGET_DIR/excalidraw-print.app"
echo "You can now launch it from Spotlight, Launchpad, or Finder > Applications."
