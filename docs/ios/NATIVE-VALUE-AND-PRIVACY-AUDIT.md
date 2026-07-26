Both audits complete. Here is the deliverable.

---

# Section A — Guideline 4.2 (Minimum Functionality) audit

**What the app is:** a Capacitor WKWebView that loads the live production site (`server.url: https://blackouttrades.com`, `/home/user/blackout-web/apps/blackout-ios/capacitor.config.ts:38`). On its own that is exactly what 4.2 rejects. The question is what genuine native value is layered on top.

| Native capability | Wired? | Evidence (file:line) |
|---|---|---|
| WKWebView loads live site | yes (baseline — not itself "value") | `apps/blackout-ios/capacitor.config.ts:38` (`url: "https://blackouttrades.com"`) |
| iOS-shell UA detection → whole native-styled chrome | **yes** | `capacitor.config.ts:31` (`appendUserAgent: "BlackOutiOSApp"`); `src/app/layout.tsx:83` head script adds `html.ios-app`; `src/lib/ios-app-shell.ts:17` |
| App-only chrome: native header, slide menu, instrument rail, page transitions, viewport/keyboard tuning | **yes** (web-rendered, but iOS-app-exclusive UI) | `src/components/ios/IosAppChrome.tsx:64-105`; `src/components/IosAppTabBar.tsx:42-94`; `src/hooks/useIosNativeShell.ts:10`; `src/components/ios/IosViewportLock.tsx`; `src/hooks/useIosKeyboardInset.ts` |
| Haptics (Capacitor Haptics plugin) | **yes — genuine native API bridge** | plugin dep `apps/blackout-ios/package.json` (`@capacitor/haptics`); bridge `src/lib/ios-haptics.ts:10-33` (`window.Capacitor.Plugins.Haptics`); called `src/components/IosAppTabBar.tsx:73`, `src/components/ios/IosNativeMenu.tsx:37,99` |
| Splash / launch screen (SplashScreen plugin) | **partial** — config-only, native launch screen, no `.hide()` call (auto-hides on timer) | dep `@capacitor/splash-screen`; `capacitor.config.ts:70-74` (`launchShowDuration:1200`, bg `#040407`) |
| Status bar (StatusBar plugin) | **partial/no** — plugin installed but **never called**; styling done via meta + CSS safe-area instead | dep `@capacitor/status-bar` present, but **zero** `StatusBar.*` calls in `src/` (grep empty); handled by `src/app/layout.tsx:64` (`statusBarStyle:"black-translucent"`) + `env(safe-area-inset-*)` in `globals.css` |
| Push notifications / APNs (PushNotifications plugin) | **NO — aspirational only** | plugin dep + `capacitor.config.ts:75-77` configure it, but **no** `PushNotifications.register()` / `Capacitor.Plugins.PushNotifications` anywhere in `src/`. The only push impl is **Web Push via service worker** — `src/lib/push-client.ts:45-56` (`Notification.requestPermission` + `pushManager.subscribe`), `public/sw.js:60-75`, `src/app/api/push/subscribe/route.ts`. Web Push does **not** function inside a Capacitor WKWebView (needs a Safari home-screen PWA), so in-app the toggle reports "unsupported" and no APNs token is ever requested |
| Biometric / Face ID app-lock | **NO — aspirational only** | `capacitor.config.ts:9-12` comment claims "a biometric gate (added in the Xcode/native phase — see README)", but: no biometric plugin in `package.json`; **zero** matches for biometric/FaceID/app-lock in `src/` (grep empty); README does not actually describe it; no committed native `ios/` dir |
| Offline shell | **partial** — static reconnect splash + prod PWA SW | `apps/blackout-ios/www/index.html` ("Reconnecting to the desk…"); `src/components/PwaRegister.tsx:11-27` |
| `@capacitor/app` (deep links / back-button / appUrlOpen) | **no** — dep present, unused in web layer | dep in `package.json`; no `App.addListener`/`appUrlOpen` usage in `src/` |
| `@capacitor/browser` (in-app Safari for external links) | **no** — dep present, no `Browser.open` usage in `src/` | dep in `package.json`; grep empty |

**4.2 verdict:** **Defensible but thin — clears 4.2 on substance, but riskier than it should be.** The app is materially more than a bare wrapper: an entire iOS-app-exclusive native-styled shell (custom header/menu/instrument-rail/page-transitions, viewport + keyboard tuning) plus a **real native API in use (Haptics)** and a native launch/splash. Apple's 4.2 bar is "app-like experience + some native capability," and Haptics-on-interaction + app-only chrome meets it. The exposure is that the **two headline native features named in the config/README — push notifications and biometric app-lock — are not wired at all**, and the in-app push path is silently non-functional. That is a 4.2 softness *and* a 2.3.1 accurate-metadata risk if the App Store description promises "alerts/notifications."

**Recommended additions (in priority order to harden 4.2 and make the config honest):**
1. **Wire real APNs** via `@capacitor/push-notifications`: call `.register()` in the iOS shell, capture the APNs device token, POST to a new native-token table (parallel to `push_subscriptions`), and fan out GEX/0DTE alerts server-side via APNs. This replaces the inert web-push path in-app and gives a flagship native feature. Gate the existing web-push toggle to hide when `isIosAppShell()` so it never shows "unsupported."
2. **Add biometric Face ID app-lock** (e.g. `capacitor-native-biometric`/community plugin) gating app resume — the config already advertises it; make it real.
3. **Actually call `@capacitor/status-bar`** (`setStyle`/`setOverlaysWebView`) instead of relying only on the meta tag.
4. **Deep-link handling** via `@capacitor/app` `appUrlOpen` so a pushed alert opens straight to the relevant desk (makes push actionable + adds native routing).
5. Optional: native share sheet (`@capacitor/share`) for sharing a chart/play.

---

# Section B — App Privacy data-collection inventory

| Data type | Collected? | Purpose | Linked to identity? | Used to track? | Source (file:line) |
|---|---|---|---|---|---|
| Email address | yes | App functionality (account / auth) | **Yes** | No | Clerk (`@clerk/nextjs`); shown `src/components/account/AccountProfilePanel.tsx:56-63`; auth via `@clerk/nextjs/server` throughout |
| Phone number | yes | App functionality (account security / 2FA) | **Yes** | No | Clerk — instance **requires a phone number on user creation** (per repo CLAUDE.md env note); collected at Clerk sign-up |
| User ID (Clerk `userId`) | yes | App functionality (identity, entitlement keys) | **Yes** | No | `auth()` used app-wide; keys `push_subscriptions.user_id` (`src/app/api/push/subscribe/route.ts:49-57`), membership rows |
| Purchase / subscription history (Whop membership + tier) | yes (derived; purchase happens on web/Whop, not in-app) | App functionality (tier gating / entitlements) | **Yes** | No | `@whop/sdk`; `membership_kind`/`tier` in `src/lib/admin-users.ts:76-167`, `src/lib/admin-user-access.ts:14-19` |
| Push subscription token + keys (web-push endpoint / p256dh / auth) | yes (web; inert in the iOS WKWebView today) | App functionality (deliver alerts) | **Yes** (row carries `user_id`) | No | `src/app/api/push/subscribe/route.ts:10-18,49-57`; `src/lib/push-client.ts:45-56` |
| Crash data (exceptions/stack traces) | conditional — Sentry, **dormant unless `SENTRY_DSN` set**; server-side only | App functionality (diagnostics) | **No** — events tagged `source`/`scope` only; **no** `setUser`/email/phone; **no** client init, **no** session replay | No | `src/lib/error-sink.ts:63-106,197-215`; **no** `withSentryConfig`/`Sentry.init`/`replayIntegration` anywhere (grep empty) |
| Other diagnostic data (client error reports + IP) | yes | App functionality (diagnostics) + security/rate-limiting | **No** (no `userId` on these rows) — **IP** captured in error meta | No | `src/app/api/telemetry/client-error/route.ts:18,56`; `src/app/api/telemetry/auth-failure/route.ts:24,55` (`meta:{ip}` via `getClientIp`) |
| Session cookies (`__session` JWT, `__client_uat`) | yes | App functionality (auth session) | **Yes** | No (first-party only) | `src/lib/clerk-session-jwt.ts`, `src/lib/auth-server.ts`, `src/middleware-clerk.ts` |
| Advertising ID / IDFA / device fingerprint | **no** | — | — | — | grep for IDFA/advertising/fingerprint/adid = no real hits (only internal incident-ID false positives) |

**SDK / tracker note for label accuracy:**
- **No third-party analytics or tracking SDK is present.** Confirmed absent: PostHog, Segment, Google Analytics/`gtag`, Amplitude, Mixpanel, Meta/Facebook pixel, Datadog RUM, Heap, Hotjar, FullStory. Every "analytics" match in `src/` is **internal product/admin analytics about trading signals** (Helix/Nighthawk/SPX/X-marketing dashboards), not user-behavior tracking.
- **Clerk** (`@clerk/nextjs` 7.5.x) — identity provider only; collects email + phone + userId. Not a tracker.
- **Sentry** (`@sentry/nextjs` 10.66) — error monitoring, **server-side only, dormant unless `SENTRY_DSN` is configured**, no browser SDK, no session replay, no user identity attached. Declare **Crash Data / Other Diagnostic Data** only if the DSN is live in prod; mark it **Not Linked**.
- **Whop** (`@whop/sdk`) — subscription/entitlement source → declare **Purchases (Purchase History)**, linked.
- **web-push / VAPID** — first-party, no third party.
- **"Used to Track You" column should be empty for every type** — nothing is shared with data brokers or used for cross-app/cross-site advertising, so **no ATT prompt is required**.

**Suggested nutrition-label mapping:** Contact Info → Email (linked, functionality) + Phone (linked, functionality); Identifiers → User ID (linked, functionality); Purchases → Purchase History (linked, functionality); Diagnostics → Crash Data + Other Diagnostic Data (**not linked**, only if Sentry DSN is live). Nothing under Usage Data, Location, Financial Info (no in-app payments), or Tracking.

One caveat to flag to whoever fills the label: the **IP address** stored in `telemetry` error `meta` (`client-error`/`auth-failure` routes) is used for diagnostics + rate-limiting. Apple exempts data used *solely* for security/fraud/rate-limiting, but because it is also retained in diagnostic error rows, the safe call is to disclose it under **Diagnostics → Other Diagnostic Data (Not Linked)** rather than omit it.
