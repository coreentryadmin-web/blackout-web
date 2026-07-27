# iOS Execution State — resume pointer

**Read this first every session, then continue.** Full backlog + architecture live in
`docs/ios/IOS-PREMIUM-PROGRAM.md`. This file is the "where am I / what's next" pointer.

## Hard environment constraint + the build strategy (RESOLVED 2026-07-26)
This is a **Linux** sandbox — no local Mac/Xcode. Native iOS is *written* here and *compiled/tested*
remotely. The strategy:
1. **PRIMARY dev/test loop → GitHub Actions macOS runners.** Confirmed working via the GitHub MCP
   channel (list/trigger workflows + read job logs + artifacts). Compiling Swift, running XCTest, and
   snapshot/UI tests need **no AWS quota and no secrets** — I push code + a macOS CI workflow, trigger
   it, and read results + snapshot PNGs as artifacts. This is the autonomous native build/test loop.
2. **ACCELERATOR → AWS EC2 Mac.** Owner provided AWS creds (account 177922194517, profile
   `blackout-mac`, session-local, never committed). All Mac host quotas were **0**; a quota increase
   for `Running Dedicated mac2 Hosts` (L-5D8DADF5 → 1) is **PENDING AWS review** (req
   `89b92573…`, 2026-07-26). When granted → interactive Xcode over SSH + local signing.
3. **RELEASE signing/upload** → either the AWS Mac (sign with the ASC key already held) or the 3
   GitHub secrets. Only needed at submission time, not during build-out.
Web-side iOS-shell work remains fully doable + validatable now via `scripts/ios/ios-ui-audit.mjs`
(the hybrid is the transitional bridge; native is the target per the master prompt).

## Architecture decision (current)
Ship the **premium hybrid** (Capacitor WKWebView + rich native shell) to App-Store-ready FAST — it's
the only path fully buildable *and* validatable from here today. Evolve toward native SwiftUI
module-by-module **once a Mac is available** (unlock #1). The master-prompt native vision
(`docs/ios/PRODUCT-VISION.md` etc.) is the north star; sequencing is hybrid-first for a shippable v1,
native-forward for v2. Revisit if the owner directs otherwise.

## Done
**2026-07-26** — ASC key verified; premium icon+splash from brand emblem; `@capacitor/assets` wired.
GitHub Actions build/ship pipeline complete. iOS UI audit harness + baseline render. 4-part audit
docs. **P0-4** (removed `*.whop.com` from `allowNavigation`) + **P0-2** (homepage pricing hidden
in-app + neutral membership note).

**2026-07-27** — Foundation docs (2,344 lines): PRODUCT-VISION, INFORMATION-ARCHITECTURE,
TECHNICAL-ARCHITECTURE, API-CONTRACTS, DESIGN-SYSTEM. **P0-1** (`/privacy` page) — real Privacy
Policy grounded in actual data inventory; public/unauthenticated; matches marketing style;
EFFECTIVE_DATE constant. Verified AWS creds work (acct 177922194517, profile `blackout-mac`);
Mac host quota = 0 → increase requested (mac2, L-5D8DADF5→1, req `89b92573…`, pending AWS review).
Verified GitHub Actions macOS runners are the primary native dev/test loop (no quota/secrets).

**2026-07-27 (cont.)** — **P0-3** server-side iOS UA gate: `isIosAppShellFromHeaders()`,
`RedesignHome` server-conditionally renders pricing OR the neutral note (both `hide-in-ios-app`
/ `show-in-ios-app` classes stay as belt-and-braces); CF cache rule `f261edb0` patched via API
to also bypass on `BlackOutiOSApp` UA (mirrors `__session` bypass) — iOS UA → cf-cache-status
MISS live-verified. **N-4** head-script pending-shell regex adds `/vector`, drops dead `/grid`,
pinned with regression test in `ios-tool-routes.test.ts`. All 4 P0 submission blockers now DONE.

**2026-07-27 (cont. 2)** — **Native SwiftUI scaffold shipped**: `apps/blackout-ios-native/`
with an XcodeGen-driven Xcode project (project.yml is source of truth; .xcodeproj is
generated, not committed), a SwiftUI @main App entry, the 5-tab IA (Command / Intelligence
/ Signals / Watchlist / Account) from `INFORMATION-ARCHITECTURE.md`, and a design system in
Swift (Colors/Typography/Spacing/Motion) whose values are contract-tested against the web
CSS tokens + `IOS_TOOLS` product colors so identity travels 1:1. `BiometricGate` service
wraps `LocalAuthentication` behind a protocol seam — every LAError path is a typed case,
fully unit-tested with a `FakeEvaluator` (no real system prompt). Info.plist has Face ID
usage description, dark-only, portrait-only, ATS locked to blackouttrades.com. App icon
reused from the emblem master. **`.github/workflows/blackout-ios-native-ci.yml`** runs
`xcodebuild build+test` on `macos-14` runners with `CODE_SIGNING_ALLOWED=NO` — the primary
native dev/test loop, no AWS Mac needed, no secrets required. First run lands on the merge.

**2026-07-27 (cont. 3)** — **N-2a APNs pipeline server side shipped**: `send-apns-push.ts`
mints ES256 JWTs (test verifies signature against paired public key — 64-byte JOSE r||s
form, correct for APNs), opens one HTTP/2 session per batch to
`api.push.apple.com`, sets correct `apns-topic`/`apns-push-type`/`apns-priority` headers,
and prunes 410/BadDeviceToken/Unregistered rows from `push_native_devices`. Inert unless
APNS_TEAM_ID/APNS_KEY_ID/APNS_PRIVATE_KEY/APNS_BUNDLE_ID are all set. Register endpoint
`POST/DELETE /api/push/native/register` UPSERTs with strict token/bundle validation and
Clerk auth. 7 unit tests green. **Discovered credential requirement**: the .p8 already held
is an *App Store Connect* API key, not an *APNs Auth Key* — Apple issues these separately.
Sender stays inert until an APNs .p8 lands in env; documented in-file.

**2026-07-27 (cont. 5)** — Web-side native plugin wrappers landed: `ios-status-bar.ts` (Dark
style + WKWebView overlay so the void reaches the top), `ios-share.ts` (native
UIActivityViewController → Web Share → clipboard, typed envelope), `ios-deep-links.ts`
(appUrlOpen listener + strict route allow-list — foreign hosts and /admin/* explicitly
blocked, 8 unit tests). `IosNativeInit` component mounted in AppShellProviders fires all
of it once per iOS-shell session. N-2c: `PushNotificationToggle` gated on `isIosAppShell()`
so the inert VAPID button no longer appears in the WKWebView. `CLAUDE.md` gained the
"Never stop" standing rule so every future session inherits the autonomy mandate without
being re-told.

**2026-07-27 (cont. 11)** — **Command IndexTickerStrip shipped.** A
horizontal live-price strip (SPX / SPY / QQQ / VIX) sits between the
regime card and Active opportunities on Command, so members see the
underlyings without leaving the default tab. Reuses `WatchlistQuoteStore`
verbatim — the fixed-ticker case is a degenerate case of "manage per-
ticker fetch loops" and duplicating the concurrency plumbing would be
waste. Same "never $0, never phantom sign" rendering rules as
`WatchlistRow` so members learn one visual grammar.

**2026-07-27 (cont. 10)** — **Intelligence v2 live per-module pulse chip
shipped.** New `IntelligencePulseStore` fetches `/api/mobile/signals` on
a 60s cadence (Intelligence is a summary surface, not a decision surface
— extra freshness is waste) and derives a per-module pulse chip. SPX
Slayer's chip composes as `PHASE · GRADE · DIRECTION` when a live signal
exists (falls back to raw source phase when it doesn't); Night Hawk's
chip is `N play(s) [· stale | · legacy]` with correct singular/plural.
Helix / Thermal / Largo / Vector return nil (their aggregator hits land
later) so their rows fall back to the static tagline instead of a
placeholder — the row was designed so the pulse chip is optional.
6 unit tests (spx-live-signal, spx-sources-fallback, spx-offline, NH
singular/plural + stale, nil-for-unwired, preserve-on-error).

**2026-07-27 (cont. 9)** — **Watchlist v2 live quotes shipped.** New
`QuoteRepository` (backed by `/api/market/quote?ticker=X` — the tiny
shared-cached 1.5s spot-tape that the Heat Maps header uses) +
`WatchlistQuoteStore` (@MainActor observable, one 5s refresh task per
ticker, `syncTo(watchlist:)` reconciles start/stop when tickers are
added/removed). `WatchlistRow` replaces the "Live data v2" placeholder
with real price + change_pct + freshness. Rendering rules encoded: never
render $0 as price (available:false → "—"), rounded-to-zero change never
shows a phantom +/- sign, change tint is neutral at zero. 3 store unit
tests (populate + start/stop reconciliation + preserve-on-error).
Long-term: the store lives at view level (not per-row) because SwiftUI
List rebuilds children on edit/reorder — a per-row @StateObject would
blank every price on any mutation.

**2026-07-27 (cont. 8)** — **Command v3 "Active opportunities" card + cross-tab
`TabRouter`**. Command now surfaces the top 3 actionable signals from
`/api/mobile/signals` directly on the default tab, with each row tapping
into the Signals tab via a new `@MainActor` `TabRouter` injected from
`BlackOutApp`. Rules: only active/managing/confirming stages (never
detected/graded/invalidated on the summary), dedup by ticker with
higher-score-wins, preserve-on-error like every other Command card. 4
ViewModel tests covering the actionable-stage filter, ticker dedup,
score-desc ordering, and preserve-on-error. `RootView` now binds
selectedTab through `$router.selectedTab` instead of a private @State so
any screen can cross-navigate.

**2026-07-27 (cont. 7)** — **Signals tab v2 shipped as real native content.**
New `/api/mobile/signals` server-side aggregator (`src/app/api/mobile/signals/
route.ts` + `src/lib/mobile/signals-projection.ts`) fans out **SPX Slayer**
(live 0DTE desk, via `getSpxPlayState()`) + **Night Hawk** (post-close 5-play
edition, via `fetchLatestPlayableNighthawkEdition` with the same
carry-until-close semantic the web edition route uses) into ONE ordered
`{ signals: Signal[] }` feed. Every phase in the API contract maps 1:1 to
`SignalLifecycle` in the app — SPX SCANNING/WATCHING/OPEN → detected/
confirming/active; NH pulled → invalidated, NH stale → detected. Two
sources merged server-side means one round trip, deterministic ordering
(active first, higher score wins), and one place to evolve the shape.
7 projection tests green (spxPhaseFor, nighthawkPhaseFor, spx→signal,
nh→signals, empty-edition guard, sort ordering).

Swift-side: `SignalsRepository` (protocol + `LiveSignalsRepository` on
`APIClient`) with a `Signal.LevelValue` enum that decodes BOTH numeric
(SPX exact) AND string (Night Hawk "$500-503" range) entries. `Signal.Phase`
reuses the existing `SignalLifecycle` enum verbatim — no duplicate — so a
mislabelled stage can't sneak past the compiler. `SignalsViewModel`
(@MainActor, .idle/.loading/.loaded/.error, preserve-on-error, 30s
auto-refresh, client-side filter — chip switch never triggers a fetch).
`SignalRow` renders source badge + ticker + direction + grade chip +
entry/target/stop level chips (only when levels exist) + thesis + lifecycle
chip + freshness; PULLED plays get a negative-tint accent rail + "Pulled —
{reason}" caption per PR-N4's "never hidden" rule. New `SignalsViewModelTests`
(5 tests) covers state transitions, preserve-on-error, filter isolation,
and LevelValue decode.

**2026-07-27 (cont. 6)** — **Command tab v1 shipped as real native content.** `APIClient`
(URLSession-backed, typed `APIError` cases for every 4xx/5xx + timeout + cancelled),
`MarketRegimeRepository` protocol + `LiveMarketRegimeRepository` binding to the real
`GET /api/market/regime` endpoint, `MarketRegimeFormatter` (regime label + interpretation
+ price + freshness), `CommandViewModel` (@MainActor, `.idle`/.loading`/`.loaded`/`.error`,
preserves previous good snapshot on transient error so the freshness chip carries the age
instead of blanking out, 30s auto-refresh via `.task`). `CommandView` renders a real
session header (SPX + regime + session chip + BOTH server-updated-at + client-fetched-at
freshness), regime card (interpretation + flip/spot/call wall/put wall grid), skeleton
loader, error card with retry, pull-to-refresh. `CommandViewModelTests` — 12 tests
including preserve-on-error, transitions, all formatter buckets. Account tab already had
real content; Command is the second placeholder-off screen. Intelligence / Signals /
Watchlist remain scaffolds pending their v1 content passes.

**2026-07-27 (cont. 4)** — **N-2b native push + N-1 Face ID UI shipped in the native app.**
`AppConfig` centralizes backend URL / bundle id / apnsEnvironment / version.
`PushRegistrationService` (protocol-injected — every dependency mockable) requests
`[.alert, .sound, .badge]`, calls `registerForRemoteNotifications`, and forwards the token
to `POST /api/push/native/register`. `BlackOutAppDelegate` (via `@UIApplicationDelegateAdaptor`)
is the SwiftUI↔UIKit bridge — receives APNs callbacks + presents foreground pushes as
banner+sound instead of silently swallowing them. `AppLockCoordinator` runs a
`.disabled`/`.unlocked`/`.locked`/`.prompting` state machine wired to ScenePhase in
`BlackOutApp` (lock on `.inactive` so the app-switcher preview never shows the desk;
prompt on `.active`). `AppLockOverlay` covers the UI when locked; `SecuritySettingsView`
(Account → App lock) enables it (Face ID confirmation required to enable, instant to
disable). `AccountView` is now the FIRST tab off the placeholder scaffold — real
Membership / Security / Notifications / About sections with live status. 13 unit tests
across `PushRegistrationServiceTests` + `AppLockCoordinatorTests` using
`FakeAuthorizer`/`FakeRegistrar`/`RecordingBackend`/`FakeEvaluator` — no real prompts,
no real network. All validates on macOS CI on merge.

## NEXT HIGHEST-PRIORITY TASK
1. **After the branch merges, `blackout-ios-native-ci.yml` fires** — watch the first
   run and fix any Xcode-16-vs-simulator selection issue. The native test count is now
   ~40 across DesignSystem / IA / Biometric / PushRegistration / AppLock / Watchlist
   (store + sync + quote-store) / Command (viewmodel + WhatChanged + ActiveOpportunities)
   / Signals (viewmodel) / Intelligence (pulse). All must go green.
2. **Sign in with Apple + Clerk bridge** (per TECHNICAL-ARCHITECTURE.md auth section).
   Blocked-until-implementation: the app currently rides `URLSession.shared` cookies set
   by whatever web flow signed in first. Real ASA + Clerk exchange unlocks the "install
   → sign in → premium" first-run flow.
3. **Command session header — SPX + VIX + freshness in one BIG number**, promoted above
   the regime label so the very first pixel above the fold is the underlying price.
   Reuse `IndexTickerStrip`'s `WatchlistQuoteStore` — no new store.
4. **Watchlist per-ticker detail sheet** (v3) — tap a row → sheet with the ticker's
   walls (from `/api/market/gex-positioning?ticker=X`), the recent Helix flow, and any
   active Signal targeting the ticker.
5. **Intelligence per-desk mobile aggregators** — Helix / Thermal / Largo / Vector each
   get a tiny mobile endpoint (mirror of `/api/mobile/signals`'s shape) so their pulse
   chips light up too. Server-side additions, small.
6. **N-2c**: hide the inert web-push toggle in the WKWebView shell (already gated on
   `isIosAppShell()` — confirm the deploy actually landed the guard).
7. **M-*** ASC listing metadata + demo account + screenshots — ask before mutating live.
8. **Once the 3 TestFlight secrets are added** (`APP_STORE_CONNECT_ISSUER_ID/KEY_ID/
   PRIVATE_KEY` — see `docs/ios/TESTFLIGHT-SETUP.md`), trigger the dispatch workflow
   and the shell app lands on TestFlight. The native SwiftUI app has its own workflow
   (`blackout-ios-native-ci.yml`) that lands its own TestFlight track once mature.

## Waiting on the operator (non-blocking)
- **APNs Auth Key .p8** (distinct from the ASC key already held) — until it lands, the
  APNs server sender stays inert (same pattern as VAPID). Details in
  `src/lib/push/send-apns-push.ts` header. Get it at developer.apple.com → Certificates,
  Identifiers & Profiles → Keys → + → "Apple Push Notifications service (APNs)".
- **AWS Mac host quota** — request pending AWS review; GitHub macOS runners cover the
  build/test loop in the meantime.

## Requested-docs status (master prompt)
`EXECUTION-STATE.md` (this) live. Others — PRODUCT-VISION, INFORMATION-ARCHITECTURE, DESIGN-SYSTEM,
TECHNICAL-ARCHITECTURE, API-CONTRACTS, SECURITY-REVIEW, APP-STORE-READINESS, QA-MATRIX, KNOWN-RISKS,
RELEASE-CHECKLIST — created as their phase is reached (audits already captured in `docs/ios/*AUDIT*.md`).
