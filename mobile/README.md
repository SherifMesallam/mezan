# Mezan Mobile (Flutter)

Expense tracker app for Egypt/MENA. Manual entry + Add from SMS (paste). Uses the Mezan backend API.

## Setup

1. Install [Flutter](https://flutter.dev/docs/get-started/install).
2. From this directory run:
   ```bash
   flutter pub get
   flutter create .  # if android/ or ios/ are missing
   ```
3. Set the API base URL: edit `lib/api.dart` and change `baseUrl` default (e.g. to your backend URL). For device emulator use `http://10.0.2.2:3000` (Android) or your machine IP.

## Run

```bash
flutter run
```

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
