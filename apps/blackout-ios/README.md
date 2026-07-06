# BlackOut — iOS app shell

A native iOS wrapper (Capacitor) around the live web app at **https://blackouttrades.com**.
It loads the production site in a `WKWebView` and adds native value (push notifications,
biometric unlock, splash) so it ships as a real App Store app — not a bare web view.

> **Payments model (important):** sign-in only. Users subscribe on the website / Whop.
> The app must **never** sell or link to checkout in-app (Netflix/Spotify model). This keeps
> it App Store compliant AND avoids Apple's 15–30% IAP cut. No purchase CTAs inside the app.

---

## What's in this scaffold (done on Windows)
- `package.json` — Capacitor deps
- `capacitor.config.ts` — appId `com.blackout-trades.app`, loads the live site, allow-lists
  Clerk / Turnstile / TradingView / Whop, dark background
- `www/index.html` — offline fallback shell only (live site loads over it when online)

The native `ios/` Xcode project is **generated on the Mac** (next section) — it can't be
created on Windows.

---

## Build runbook (on the Mac)

Prereqs on the Mac: **Xcode** (from the App Store), **Node 20+**, and **CocoaPods**
(`sudo gem install cocoapods`).

```bash
# 1. Get this folder onto the Mac (clone the repo, or copy the folder).
cd blackout-ios

# 2. Install JS deps
npm install

# 3. Generate the native iOS project (creates ios/)
npx cap add ios

# 4. Sync config + web assets into the native project
npx cap sync ios

# 5. Open in Xcode
npx cap open ios
```

In Xcode:
- Select the **App** target → **Signing & Capabilities** → pick your Team
  (needs the Apple Developer account — see below). Set a unique Bundle ID
  (`com.blackout-trades.app`).
- Add capability **Push Notifications** and **Background Modes → Remote notifications**.
- Plug in an iPhone (or use a simulator) → press **Run** ▶. The app should boot to
  the BlackOut splash, then load the live site.

---

## Apple Developer account (you do this — payment/credentials)
1. Go to **developer.apple.com/programs** → enroll (**$99/yr**). Use the business entity
   if you have one (D-U-N-S number) — recommended for a finance brand so the seller name
   isn't your personal name.
2. Once active, the Team appears in Xcode's Signing dropdown.
3. In **App Store Connect** → create the app record (name "BlackOut", bundle id above).

---

## Known gotchas (already accounted for, but verify)

### 1. Google sign-in inside a WebView is blocked by Google
Google returns `disallowed_useragent` for OAuth in an embedded web view. Clerk's
**Google** social login will fail in the plain WKWebView. Fix (native phase):
- Use `@capacitor/browser` (`Browser.open`) or `ASWebAuthenticationSession` to run the
  OAuth hop in the system browser sheet, then deep-link back via a custom URL scheme.
- Simpler interim option: in the app, prefer **email-code sign-in** (already enabled in
  Clerk) which works fine inside the web view; keep Google for web only.

### 2. Apple "minimum functionality" (guideline 4.2)
A pure remote wrapper with zero native features risks rejection. We satisfy this with
**push notifications + biometric unlock + native splash**. Make sure at least push is
actually wired and demonstrated before submitting.

### 3. Real-time streams (SSE / WebSocket)
The desk's live data (pulse SSE, options marks) runs over `https`/`wss` — works in the
WKWebView as-is. No native re-plumbing needed for the wrapper approach. Verify on device
that the streams connect (they need the `allowNavigation` + ATS allowing the domains).

### 4. App Transport Security
All traffic is HTTPS already (HSTS on the zone), so no ATS exceptions needed. Don't add
`NSAllowsArbitraryLoads`.

---

## App Store submission checklist
- [ ] Apple Developer account active; Team selected in Xcode
- [ ] Bundle ID `com.blackout-trades.app` registered
- [ ] App icon (1024×1024) + all sizes; splash matches `#040407`
- [ ] Push notifications capability + APNs key uploaded to App Store Connect
- [ ] Google OAuth routed through system browser (or email-code only in app)
- [ ] **No in-app purchase links / upsell** (sign-in only) — re-check every screen
- [ ] Privacy "Nutrition Label" filled (what data is collected — Clerk/account, analytics)
- [ ] Support URL, marketing URL, privacy policy URL (you have these on the site)
- [ ] "Educational, not financial advice" disclaimers visible (already in the web UI)
- [ ] Demo account credentials for the Apple reviewer (so they can see past the paywall)
- [ ] TestFlight build tested on a real device first, then submit for review

---

## Phase 2 (after it's accepted)
- Native biometric (Face ID) app-lock — `capacitor-native-biometric` plugin
- Native push wiring end-to-end (APNs ↔ your existing notification system / VAPID replacement)
- Deep links (open specific tools from a notification)
- Haptics, native share sheet
