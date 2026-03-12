#!/usr/bin/env bash
# Run this ONCE after you install Xcode from the App Store.
# You will be prompted for your Mac password (for sudo).

set -e
cd "$(dirname "${BASH_SOURCE[0]}")"

if [[ ! -d /Applications/Xcode.app ]]; then
  echo "Xcode is not installed. Install it from the App Store, then run this script again."
  exit 1
fi

echo "Pointing command-line tools to Xcode (you may be asked for your password)..."
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer

echo "Accepting Xcode license..."
sudo xcodebuild -license accept 2>/dev/null || true

echo "Running CocoaPods install..."
export LANG=en_US.UTF-8
(cd ios && pod install)

echo "Done. You can now run: flutter devices   and   flutter run -d ios"
