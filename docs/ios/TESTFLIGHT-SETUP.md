# TestFlight on your phone — one-time 2-minute setup

Once these 3 secrets are added, I can trigger a build → sign → upload to
TestFlight from CI on demand, and every future push to `apps/blackout-ios/**`
on `main` auto-builds a fresh TestFlight version. You never touch it after
this once.

## Step 1 — Add 3 GitHub Actions secrets (paste, once)

Open: **GitHub → `coreentryadmin-web/blackout-web` → Settings → Secrets and
variables → Actions → New repository secret** (button top-right).

Add these three:

| Secret name | Value |
|---|---|
| `APP_STORE_CONNECT_ISSUER_ID` | `23ce7163-7a7a-42ce-946d-b53b0006537b` |
| `APP_STORE_CONNECT_KEY_ID`    | `BJ4MJ3676G` |
| `APP_STORE_CONNECT_PRIVATE_KEY` | **Paste the entire `.p8` file** — from `-----BEGIN PRIVATE KEY-----` to `-----END PRIVATE KEY-----` inclusive, with the multi-line format preserved. GitHub Secrets handles multi-line just fine. |

You already sent me all three of these values earlier this session (the .p8
lives at `/root/.claude/uploads/…/AuthKey_BJ4MJ3676G.p8` in my session
sandbox — I never committed it, and never can from here). Just re-paste
them into GitHub so CI has them.

Then reply "secrets added" and I'll trigger the first build.

## Step 2 — I take it from here

I trigger `BlackOut iOS TestFlight` via the GitHub Actions dispatch. The
workflow (`.github/workflows/blackout-ios-testflight.yml`, shipped earlier
this session):
1. Runs on a macOS runner.
2. Installs `codemagic-cli-tools` (used purely as a `xcode-project` +
   `keychain` helper — no Codemagic account, no third-party service).
3. Fetches / creates the distribution cert + provisioning profile via the
   ASC API key.
4. Bumps `CFBundleVersion` to a value guaranteed higher than the last
   TestFlight build (so ASC never rejects the upload for a duplicate).
5. Builds a signed IPA (Xcode).
6. Uploads to App Store Connect via `app-store-connect publish`.

## Step 3 — What lands on your phone

- ~5 min after the workflow finishes, Apple finishes processing the build
  and it appears under **Internal Testing** in App Store Connect.
- Because you're on the Apple Developer team `ZA32C782N5`, you're already
  an internal tester by default — you get an email from Apple and the build
  installs on any device you have TestFlight open on.
- If you want to add other people (family, friends), that's a one-line
  workflow input (`beta_group: <group-name>`) after you create an
  external group in App Store Connect once.

## What you're seeing in that first TestFlight

Today, the TestFlight build is the **Capacitor WKWebView shell** —
`apps/blackout-ios`. It renders the live web app inside a native app
container, with:
- The native iOS chrome (13 CSS files, native header, command deck
  menu, native tab bar, page transitions, haptics).
- The 4 App Store submission blockers I've been fixing this session
  (currently on this branch, deploy to prod on merge — TestFlight
  build picks them up from prod after the merge deploy).
- Face ID / native APNs / etc. all served from the WKWebView shell's
  side (`ios-haptics.ts`, `ios-status-bar.ts`, `ios-share.ts`,
  `ios-deep-links.ts` — all shipped this session, all gated so they
  only run inside the iOS app UA).

The **native SwiftUI app** (`apps/blackout-ios-native/`) is a separate,
newer app I'm building alongside — Command / Intelligence / Signals /
Watchlist / Account tabs, ~55 Swift files + tests. It uses a different
CI workflow (`.github/workflows/blackout-ios-native-ci.yml`) that lands
its own TestFlight track once mature. Same ASC key covers both.

## Rollback / cancel

- **Stop future auto-builds**: revoke the ASC API key at
  `appstoreconnect.apple.com → Users and Access → Integrations → App Store
  Connect API` — that leaves the workflow in place but every trigger
  will fail cleanly.
- **Remove a shipped TestFlight build**: from App Store Connect →
  TestFlight → expire the build. Existing installs keep working; new
  installs blocked.
