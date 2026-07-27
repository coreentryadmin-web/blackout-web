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
1. **After the branch merges + prod deploys**, run the audit to prove the P0 set is live:
   `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node scripts/ios/ios-ui-audit.mjs --base https://blackouttrades.com --pages "/,/privacy"`
   Expected: `/` iOS render shows the neutral note + **no** pricing DOM; `/privacy`
   returns the policy.
2. **After the branch merges, `blackout-ios-native-ci.yml` fires** — watch the first run
   and fix any Xcode-16-vs-simulator selection issue. All 4 native test files (design system,
   IA, biometric, push, app-lock) must go green.
3. **N-2c**: hide the inert web-push toggle in the WKWebView shell so members don't see
   "unsupported" (small, iOS-gated CSS/JS change on the web side).
4. **N-3**: `@capacitor/status-bar` calls + `@capacitor/app` `appUrlOpen` deep links →
   route pushed alerts to the right destination + native share via `@capacitor/share`.
5. **Command tab first native content** — session header (SPX/SPY/QQQ/VIX + market status
   + last update) + market regime cards, backed by real endpoints per `API-CONTRACTS.md`.
   Repository pattern with a mockable networking layer so tests don't hit prod.
6. **Sign in with Apple** + Clerk bridge (per TECHNICAL-ARCHITECTURE.md auth section).
7. **U-*** per-page premium polish for the WKWebView shell (parallel track).
8. **M-*** ASC listing metadata + demo account + screenshots — ask before mutating live.

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
