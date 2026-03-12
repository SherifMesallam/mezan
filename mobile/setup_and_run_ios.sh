#!/usr/bin/env bash
# Run from project root (mezan) or from mobile/. Does full iOS setup and runs the app.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v flutter &>/dev/null; then
  echo "Flutter not found in PATH. Install from https://flutter.dev/docs/get-started/install"
  exit 1
fi

echo "=== Flutter doctor ==="
flutter doctor -v

echo ""
echo "=== Pub get ==="
flutter pub get

if [[ ! -d ios ]]; then
  echo ""
  echo "=== Creating iOS (and Android) project ==="
  flutter create .
fi

if [[ -d ios ]]; then
  if command -v pod &>/dev/null; then
    echo ""
    echo "=== CocoaPods install ==="
    (export LANG=en_US.UTF-8; cd ios && pod install)
  else
    echo ""
    echo "CocoaPods not found. Install with: sudo gem install cocoapods   or   brew install cocoapods"
    echo "Skipping pod install. Run it manually after installing CocoaPods."
  fi
fi

echo ""
echo "=== Devices ==="
flutter devices

echo ""
echo "=== Running on iOS (first available device) ==="
flutter run -d ios
