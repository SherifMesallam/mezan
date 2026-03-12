# Mezan Mobile (Flutter)

Expense tracker app for Egypt/MENA. Manual entry + Add from SMS (paste). Uses the Mezan backend API.

## Setup

1. Install [Flutter](https://flutter.dev/docs/get-started/install) (macOS required for iOS).
2. Install Xcode from the App Store (for iOS Simulator / device).  
   CocoaPods: `sudo gem install cocoapods` (or via Homebrew).
3. From this directory run:
   ```bash
   flutter pub get
   flutter create .   # if android/ or ios/ are missing
   cd ios && pod install && cd ..
   ```
4. **API base URL** is set at build time (see `lib/config.dart`). Default is `http://localhost:3000`. For Simulator use your Mac’s IP (e.g. `http://192.168.x.x:3000`). For production build use `--dart-define=MEZAN_API_URL=https://your-app.onrender.com`.

## Run

```bash
flutter run
```

## Test the iOS app (all-in-one)

In a terminal where `flutter` is in your PATH (e.g. your normal Mac terminal), from the repo root or from `mobile/`:

```bash
# From repo root
./mobile/setup_and_run_ios.sh

# Or from mobile/
cd mobile && ./setup_and_run_ios.sh
```

The script: runs `flutter doctor`, `flutter pub get`, creates `ios/` (and `android/`) if missing, runs `pod install`, lists devices, then runs `flutter run -d ios`.

**Manual steps (if you prefer):**

```bash
cd mobile
flutter doctor -v
flutter pub get
flutter create .          # only if ios/ (or android/) is missing
cd ios && pod install && cd ..
flutter devices
flutter run -d ios        # or: flutter run -d "iPhone 16 Pro"
```

**Physical iPhone:** Connect via USB, trust the Mac, select the device in Xcode signing for `ios/Runner`, then `flutter run -d <device-id>` (device id from `flutter devices`).

### iOS: Xcode required (iPhone not in device list / xcodebuild error)

If `flutter devices` only shows macOS and Chrome and no iPhone or iOS Simulator, or you see **xcodebuild: unable to find utility "xcodebuild"**:

1. **Install Xcode** from the App Store (full Xcode, not just “Command Line Tools”).
2. **Point the command-line tools at Xcode:**
   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   ```
3. **Accept the Xcode license** (if prompted):
   ```bash
   sudo xcodebuild -license accept
   ```
4. **CocoaPods** (for iOS deps): install if `pod` is not found:
   ```bash
   sudo gem install cocoapods
   # or: brew install cocoapods
   ```
   Then in the app: `cd ios && pod install`.

After that, connect your iPhone via USB, unlock it, tap “Trust” if asked, and run `flutter devices` again — your iPhone and iOS Simulators should appear.

**One-time script after Xcode is installed:** From `mobile/`, run `./after_installing_xcode.sh`. It runs `sudo xcode-select`, accepts the license, and `pod install` (you’ll be prompted for your Mac password).

### iOS: Code signing for a physical iPhone

When you see **No valid code signing certificates were found** or **No development certificates available**:

1. **Open the project in Xcode** (use the workspace, not the project):
   ```bash
   open ios/Runner.xcworkspace
   ```
2. In the **left sidebar**, click the blue **Runner** project (top item), then select the **Runner** target (under TARGETS).
3. Open the **Signing & Capabilities** tab.
4. Check **Automatically manage signing**.
5. In **Team**, choose your Apple ID:
   - If the list is empty: click **Add an Account…**, sign in with your Apple ID (free account is enough for running on your own device).
   - Then pick that account as the Team.
6. If Xcode shows a **Bundle ID** conflict (e.g. “already in use”), change it to something unique, e.g. `com.yourname.mezan` (in the **General** tab → **Bundle Identifier**).
7. Connect your iPhone, unlock it, and select it as the run destination at the top of Xcode (or leave it for Flutter).
8. On the **iPhone**: **Settings → General → VPN & Device Management** → under Developer App, tap your Apple ID → **Trust** (if shown).
9. From the terminal, run again:
   ```bash
   flutter run -d 00008110-000120A43CDA401E
   ```
   (Use your device id from `flutter devices`.)

## Features

- **Auth:** Sign up / Log in (email + password).
- **Home:** Recent transactions, month total, budget summary (spent vs remaining).
- **Add transaction:** Manual entry with amount, category, tags, date/time, optional merchant.
- **Add from SMS:** Paste SMS text (or on Android tap **Import last SMS**) → Parse (on-device extraction) → Add transaction (uses ingest token).
- **Categories / Tags:** List (from API). Create/edit from API or future screens.
- **Charts:** Summary by category, tag, or day (from `/v1/insights/summary`).
- **Budgets:** List budgets with spent/remaining (from `/v1/budgets`).
- **Settings:** SMS on iPhone help, generate ingest token, log out.

## Ingest token

For "Add from SMS" and for iOS Shortcut/Share or Android SMS automation, the app needs an **ingest token**. Generate it in **Settings → Generate ingest token**. It is stored locally and used when posting to `POST /v1/ingest/parsed`.

## Android SMS

- **Import last SMS:** On the "Add from SMS" screen, tap **Import last SMS** (Android only). The app requests `READ_SMS`, reads the most recent inbox message, and fills the text field. Then tap **Parse** and **Add transaction**. Only the parsed payload (amount, date, anonymized text) is sent to the API; raw SMS never leaves the device.
- **Required permissions:** After running `flutter create .`, add to `android/app/src/main/AndroidManifest.xml` inside the `<manifest>` tag:
  ```xml
  <uses-permission android:name="android.permission.READ_SMS" />
  <uses-permission android:name="android.permission.RECEIVE_SMS" />
  ```
- **Future:** Auto-capture on receive (BroadcastReceiver for `SMS_RECEIVED`) can be added so new transaction SMS are parsed and sent to ingest without opening the app.

## iOS Share Extension (future)

Add an iOS Share Extension target so the user can share an SMS from Messages to Mezan. The extension receives the message text, runs the same parse + anonymize flow, and POSTs to `/v1/ingest/parsed` with the ingest token.
