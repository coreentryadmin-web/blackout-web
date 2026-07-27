# iOS Premium Program — autonomous build-to-perfect tracker

**Mandate (owner, 2026-07-26):** make the BlackOut iOS app premium end-to-end — every page,
navigation, button, layout — commercial/corporate/high-class. Wire Face ID + native iOS
enhancements. Drive it autonomously; validate on the real iOS UI; don't ask the owner to test.
Report only when it's genuinely ready.

**This file is the source of truth.** Every work cycle: read this → do the next unchecked item(s)
→ commit → merge when CI green → deploy → validate on the iPhone render → update this file. It
survives context resets; resume from here.

---

## Architecture facts (verified 2026-07-26)

- The iOS app = a **Capacitor 6 WKWebView** (`apps/blackout-ios/`) that loads **live prod**
  `https://blackouttrades.com`. So "every page of the app" = the web app's pages rendered under the
  iOS shell UA (`BlackOutiOSApp`), plus native chrome. Web changes reach the app the moment prod
  deploys — no rebuild needed. Only icon/splash/native-plugin changes need a fresh build.
- **iOS detection is 100% client-side**: an inline `<head>` script in `src/app/layout.tsx:80-98`
  adds `html.ios-app` (+ `ios-tier-pro`/`pro-max`) when UA matches. `isIosAppShell()`
  (`src/lib/ios-app-shell.ts`) reads that class. Dual-render CSS `.hide-in-ios-app` /
  `.show-in-ios-app` (defined in `globals.css` AND `marketing-base.css`) is the primary gate.
- **Existing native shell is substantial** (this is polish/complete, not from scratch): 13
  `ios-native*.css` files (imported in `src/app/(site)/layout.tsx`), native header
  (`IosNativeHeader`), command-deck menu (`IosNativeMenu`), instrument tab bar (`IosAppTabBar`),
  page transitions (`IosNativePageTransition`), viewport lock, keyboard inset, haptics
  (`src/lib/ios-haptics.ts` — the one fully-wired native bridge).
- **Tab bar (5):** `/dashboard` SPX Slayer · `/flows` HELIX · `/heatmap` Thermal · `/terminal`
  Largo (rail auto-hides) · `/nighthawk` Night Hawk. Plus `/vector` (native chrome, non-tab) and
  utility routes `/account /faq /learn /upgrade /admin`. Registry: `src/lib/ios-tool-routes.ts`.
- **Full page inventory** (native-shell prefixes: dashboard, flows, heatmap, terminal, nighthawk,
  vector, account, faq, learn, upgrade, admin):
  - `(site)`: /dashboard /flows /heatmap /terminal /nighthawk /vector /account /track-record*
    /admin/** /dev/** (*track-record & dev get NO native chrome — gap)
  - `(marketing)`: / (home) /pricing (hidden in-app) /upgrade /faq /learn/**
  - top-level: /sign-in /sign-up /offline /embed/track-record
- **Deploy:** prod repo `blackout-web` (Clerk) → `ecr-push-production.yml` on push to `main` →
  ECS `blackout-production` → Cloudflare purge. Staging = separate sandbox repo
  `blackout-web-sandbox` (Cognito). The Capacitor shell loads **prod**, so iOS-shell validation
  targets prod. **Blast radius today = ~zero**: the iOS app is not on the App Store yet, so
  `html.ios-app` code paths have no live users except our own audit harness. iOS-gated changes are
  safe to ship to prod.

## Native capabilities status

| Capability | State | Plan |
|---|---|---|
| Haptics | ✅ wired (`ios-haptics.ts`) | keep; extend to more actions |
| Splash / status bar | ⚠️ config-only, plugin never called | call `StatusBar.*`; real splash from `assets/splash.png` |
| Push (APNs) | ❌ web-push only (inert in WKWebView) | wire `@capacitor/push-notifications` register → native token table → server APNs sender |
| Face ID / biometric app-lock | ❌ advertised, not wired | add biometric plugin + resume gate + settings toggle |
| Deep links (`@capacitor/app` appUrlOpen) | ❌ dep present, unused | route pushed alerts → correct desk |
| Share (`@capacitor/share`) | ❌ absent | native share of a chart/play |

---

## Validation harness (the "eyes")

`scripts/ios/ios-ui-audit.mjs` — mints a temp premium Clerk session, renders any page list at true
iPhone resolution (430×932 @3 = App-Store 6.9") with the `BlackOutiOSApp` UA, through the agent
proxy bridge; screenshots + console-error capture; deletes the temp user. Real routes only.
```
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node scripts/ios/ios-ui-audit.mjs \
  --base https://blackouttrades.com --out artifacts/ios-<stage> \
  --pages "/dashboard,/flows,/heatmap,/terminal,/nighthawk,/vector,/account"
```
Existing complementary harness: `npm run test:ios-ui-e2e` (`scripts/ios-native-ui-e2e.mjs`) — clicks
tabs/segments/controls, asserts shell classes, two device passes. Reuse + grow it.

---

## Backlog (priority order) — check off as done

### P0 — Submission blockers
- [x] **P0-1 `/privacy` page** — real Privacy Policy at `/privacy` grounded in the actual data inventory (Clerk email/phone, Whop subscription status, push subscriptions, Sentry diagnostics, session cookies; no trackers, no ad SDKs). Public/unauthenticated. `EFFECTIVE_DATE` constant. Done 2026-07-27.
- [x] **P0-2 Homepage pricing leak (3.1.1)** — gated `#rl-pricing` + closing "See pricing" link with `hide-in-ios-app`; added a neutral `show-in-ios-app` membership note (no price/purchase) in their place. Web unchanged. Done 2026-07-26 (commit pending deploy-validation on the iPhone render).
- [x] **P0-3 Server-side iOS detection (durable 3.1.1)** — `src/lib/ios-app-shell-server.ts` `isIosAppShellFromHeaders()`; homepage server-conditionally renders pricing/neutral note based on iosApp; CF cache rule `f261edb0` patched via API to also bypass on `http.user_agent contains "BlackOutiOSApp"` (mirrors `__session` bypass); verified live: iOS UA → cf-cache-status MISS, desktop → HIT. Done 2026-07-27.
- [x] **P0-4 Remove `*.whop.com` from `allowNavigation`** (`capacitor.config.ts`) so checkout can never open in-app. Done 2026-07-26.

### N — Native premium features
- [x] **N-0 Native SwiftUI scaffold + macOS CI** (2026-07-27) — `apps/blackout-ios-native/` XcodeGen-driven, 5-tab IA, design system in Swift (contract-tested), `BiometricGate` service (LocalAuthentication behind a protocol seam, every LAError path unit-tested), Info.plist with Face ID descriptor + ATS lock, app icon reused from emblem. `blackout-ios-native-ci.yml` runs `xcodebuild build+test` on `macos-14` with no signing / no secrets — the primary native dev/test loop, no AWS Mac required. First run lands on the merge.
- [x] **N-1 Face ID UI wiring** (2026-07-27) — `AppLockCoordinator` (@MainActor ObservableObject) drives a `.disabled`/`.unlocked`/`.locked`/`.prompting` state machine wired to `ScenePhase` in `BlackOutApp` (lock on `.inactive` to hide the app-switcher preview; prompt on `.active`). `AppLockOverlay` covers the app UI when locked. `SecuritySettingsView` (Account → App lock) exposes the toggle — enabling requires a Face ID confirmation, disabling is instant. UserDefaults for the flag. `AppLockCoordinatorTests` covers cold-start, enable-with-bio-cancel-doesn't-persist, disable-no-bio-required, and lock/unlock lifecycle transitions.
- [x] **N-2a APNs pipeline — server side** (2026-07-27) — `src/lib/push/send-apns-push.ts` (ES256 JWT + HTTP/2 to `api.push.apple.com`, per-batch fresh token, 410/BadDeviceToken row prune, inert if any of `APNS_TEAM_ID/APNS_KEY_ID/APNS_PRIVATE_KEY/APNS_BUNDLE_ID` missing), `push_native_devices` table lazily created, `POST/DELETE /api/push/native/register` route with strict token/bundle validation + Clerk auth. 7 unit tests all green (JWT structure + real signature verification against a paired public key, config gating, body shaping, freshness window). **Requires a SEPARATE APNs Auth Key .p8** — the App Store Connect API key already held cannot be reused; log a fresh key at developer.apple.com → Keys → APNs (documented in-file).
- [x] **N-2b APNs pipeline — native side** (2026-07-27) — `PushRegistrationService` (protocol-injected: `NotificationAuthorizer` / `RemoteNotificationRegistrar` / `BackendRegistering`; `.live()` factory wires the production adapters). Requests permission with `[.alert, .sound, .badge]` (no criticalAlert / no provisional — reviewer prompts must be explicit), calls `UIApplication.registerForRemoteNotifications()`, hex-encodes the APNs token in the AppDelegate and POSTs to `/api/push/native/register`. `BlackOutAppDelegate` (via `@UIApplicationDelegateAdaptor`) is the SwiftUI ↔ UIKit bridge — forwards `didRegisterForRemoteNotificationsWithDeviceToken` and shows banner+sound on foreground pushes. Account tab now surfaces "Enable push notifications" with real status. 7 unit tests using `FakeAuthorizer` / `FakeRegistrar` / `RecordingBackend` — no real prompts fire.
- [x] **N-2c Hide inert web-push toggle in WKWebView shell** (2026-07-27) — `PushNotificationToggle` now short-circuits to `unsupported` (and returns null) when `isIosAppShell()` is true, so members inside the WKWebView never see the dead affordance. Native APNs is the correct path in-app.
- [x] **N-3 StatusBar / Share / Deep-link wrappers** (2026-07-27) — `src/lib/ios-status-bar.ts` (`applyIosStatusBar()`: Dark style + `setOverlaysWebView(true)` so the void reaches the top of the screen), `src/lib/ios-share.ts` (`iosShare(opts)`: native `UIActivityViewController` → Web Share API → clipboard fallback, one typed result envelope), `src/lib/ios-deep-links.ts` (`pathFromDeepLink` + `initIosDeepLinks(navigate)`: routes push-tapped URLs via `@capacitor/app` `appUrlOpen` with a strict route allow-list — foreign hosts + `/admin` blocked). 8 unit tests on the parser green. `IosNativeInit` component mounted in `AppShellProviders` fires all of it once per iOS-shell session.
- [x] **N-4 Head-script fix** — pending-shell regex in `src/app/layout.tsx` fixed to add `/vector` and drop dead `/grid`; regression test in `src/lib/ios-tool-routes.test.ts` locks it to `IOS_NATIVE_SHELL_PATH_PREFIXES`. Done 2026-07-27.

### U — Per-page premium polish (validate each on the iPhone render)
- [ ] **U-1 Dashboard (SPX Slayer)** · **U-2 Flows (HELIX)** · **U-3 Heatmap (Thermal)** · **U-4 Terminal (Largo)** · **U-5 Nighthawk** · **U-6 Vector** · **U-7 Account** · **U-8 Track-record (add native chrome — currently none)** · **U-9 FAQ/Learn** · **U-10 Upgrade** · **U-11 Sign-in/Sign-up** · **U-12 Offline** · **U-13 Home (marketing, in-app entry)**
- [ ] **U-sys** Cross-cutting: safe-area insets everywhere, 44pt touch targets, momentum scroll, no horizontal overflow, consistent type scale + tokens, tab-bar/header polish, page transitions, empty/loading/error states.

### Native-app screens — real content (replaces `PlaceholderView` one at a time)
- [x] **Account tab** (2026-07-27) — Membership + Security + Notifications + About sections. Real Face ID toggle. Push status. Version + Privacy link + Support email.
- [x] **Command tab v1** (2026-07-27) — Session header (SPX + regime + session chip + freshness), Regime card (interpretation + flip / spot / call wall / put wall grid), Skeleton loading, Error card with retry, pull-to-refresh + 30s auto-refresh via `.task`. Wired to real `GET /api/market/regime` through `LiveMarketRegimeRepository` (protocol-injected, unit-testable). `APIClient` handles the whole HTTP layer with typed `APIError` cases. 12 unit tests including preserve-previous-on-error behavior.
- [x] **Intelligence tab v1** (2026-07-27) — Six product cards (SPX Slayer / Helix / Thermal / Largo / Night Hawk / Vector) with real per-desk identity (accent color from `BOColor.Product.*`, product mark, tagline, purpose). Each card is a `NavigationLink` into a `ProductDetailView` showing the desk's purpose. `IntelligenceRegistry` is the single source of truth (id, name, mark, accent, tagline, purpose, webPath); contract-tested to match `IOS_TOOLS` in `src/lib/ios-tool-routes.ts` and the design-system product palette 1:1.
- [x] **Signals tab v1** (2026-07-27) — `SignalLifecycle` enum + horizontal filter chip rail (All + 7 stages: detected → confirming → active → managing → closed → invalidated → graded). Per-stage empty state with plain-English "what this stage means" copy. Lifecycle glossary card explains the whole state machine. Contract test locks slug order.
- [x] **Watchlist tab v1** (2026-07-27) — Local ticker CRUD with UserDefaults persistence. Add sheet with validated input (1–8 chars, letters/digits + optional single dot; case-normalized), dedupe on add, swipe-to-delete, drag-to-reorder via `.onMove`. Toolbar Add + Edit. Empty state routes into the Add sheet. 10 unit tests on `WatchlistStore` (normalize, add/dupe, remove, contains, move, persistence).
- [x] **Shared UI atoms** (2026-07-27) — `BOCard` (single card container with accent-rail variant), `BOSectionLabel` (announces as `.isHeader` to VoiceOver), `BOChip` (44pt hit target, `.isSelected` accessibility trait), `BOEmptyState` (icon + title + message + optional action, combined accessibility label). Command view refactored to use them; one look across every screen.
- [ ] **Command tab v2** — Top intelligence brief, Active opportunities, What-changed timeline, Product pulse cards backed by real endpoints.
- [ ] **Signals tab v2** — Real `/api/signals` feed with lifecycle transitions + push-triggered updates.
- [ ] **Watchlist tab v2** — Server sync (Clerk-bound), per-ticker detail + alert builder.
- [ ] **Intelligence tab v2** — In-card live pulse per desk (regime, flow, dealer state).

### I / M — Icon, assets, metadata, ship
- [x] **I-1 App icon 1024** from `public/images/blackout-emblem.webp` → `apps/blackout-ios/assets/icon.png` (opaque, no alpha).
- [x] **I-2 Splash** `assets/splash.png` + `splash-dark.png` (2732²) on `#040407`.
- [x] **I-3 Wire `@capacitor/assets`** into both CI configs (generates native sets from `assets/`).
- [x] **CI-1 GitHub Actions pipeline** completed (`.github/workflows/blackout-ios-testflight.yml`) — build+sign+upload+TestFlight via ASC key.
- [ ] **M-1 ASC listing** via API (needs owner sign-off before mutating live listing): name → "BlackOut", categories Finance/Business, age rating 4+, App Privacy labels, reviewer notes + walkthrough. Draft: `docs/ios/ASC-METADATA.md`.
- [ ] **M-2 App Store screenshots** (6.9" + 6.5") generated from the polished app via the audit harness.
- [ ] **M-3 Demo account** for Apple review (admin+premium Clerk user w/ password path; keep alive through review).
- [ ] **M-4 Delete stray MAC_OS 1.0 version** in ASC (iOS-only submission).
- [ ] **SHIP — owner's one action:** inject the ASC API key into CI once (Codemagic integration "BlackOut ASC" **or** 3 GitHub secrets). Then builds+submit run autonomously. Everything else is automated.

### Reference docs
`docs/ios/ASC-METADATA.md` · `docs/ios/COMPLIANCE-3.1.1-AUDIT.md` · `docs/ios/NATIVE-VALUE-AND-PRIVACY-AUDIT.md` · `docs/audit/LIVE-UI-CONNECTION.md`

---

## Live status log (newest first)
- **2026-07-26** — Program bootstrapped. Verified ASC key + live app state (app exists, 1 valid build 2026-07-05, iOS 1.0 draft, metadata empty, stray MAC_OS version). Built the iOS UI audit harness + captured baseline. Generated premium app icon + splash from the brand emblem and wired `@capacitor/assets`. Completed the GitHub Actions build/ship pipeline. Ran the 4-part audit (CI/metadata/3.1.1/native-value). Next: P0 blockers → native features → per-page polish.
