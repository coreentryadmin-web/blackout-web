# BLACKOUT — Native iOS Technical Architecture

> The engineering foundation for the production-grade **native SwiftUI** BlackOut iOS app.
> This document defines *how* we build the vision in `docs/ios/PRODUCT-VISION.md`: the
> language, the layering, the networking, auth, entitlements, platform capabilities, the
> build/test strategy that works from a Linux sandbox with no local Mac, and the
> WebView→native migration plan.
>
> **Everything here is grounded in the real repository.** Where the web app already does a
> thing, this doc cites the file. Where the native app must add a thing, it says so and marks
> it clearly. It never invents an endpoint, a field, or a capability.

**Companion docs:** `docs/ios/PRODUCT-VISION.md` (the north star), `docs/ios/EXECUTION-STATE.md`
(where we are / what's next), `docs/ios/IOS-PREMIUM-PROGRAM.md` (backlog + hybrid-shell facts),
`docs/ios/NATIVE-VALUE-AND-PRIVACY-AUDIT.md` (4.2 + App-Privacy inventory),
`docs/ios/COMPLIANCE-3.1.1-AUDIT.md` (purchase-UI audit), `docs/ios/ASC-METADATA.md` (listing).

---

## 0. Status legend

Every capability below is tagged so the native build is honest with itself:

- **EXISTING** — already shipped in the repo (web or the Capacitor shell); the native app consumes or ports it.
- **PARTIAL** — scaffolded/config-present but not functionally wired.
- **MISSING** — needed by the native app, not present anywhere today.
- **PROPOSED** — a native-only design decision this document is making now.

---

## 1. Where we are today (the honest baseline)

The shipping iOS vehicle is a **Capacitor 6 WKWebView** (`apps/blackout-ios/`) that loads live
production `https://blackouttrades.com` (`apps/blackout-ios/capacitor.config.ts:34`). It appends
`BlackOutiOSApp` to the WKWebView user-agent (`capacitor.config.ts:27`); an inline `<head>` script
(`src/app/layout.tsx:80-84`) detects that token and adds `html.ios-app`, which drives an
already-substantial **web-rendered native-styled shell** (`src/components/ios/*`, 13 `ios-native*.css`
files, tab registry `src/lib/ios-tool-routes.ts`). The one genuinely-wired native bridge is Haptics
(`src/lib/ios-haptics.ts`). Push and biometric are advertised in config/README but **not wired**
(`docs/ios/NATIVE-VALUE-AND-PRIVACY-AUDIT.md`). **There is no committed native `ios/` Xcode
project** — Capacitor generates it in CI on demand (`npx cap add ios`, `.github/workflows/blackout-ios-testflight.yml:107-115`).

**This document describes the target: a real SwiftUI app** that replaces the WebView surface by
surface (Section 15), talking to the *same* server contracts the web app already exposes. The
transitional hybrid stays shippable and validatable now (`docs/ios/EXECUTION-STATE.md`); native is
the destination.

Identity constants (from CI + config, already public — safe to hardcode):

| Constant | Value | Source |
|---|---|---|
| Capacitor `appId` | `com.blackouttrades.app` | `apps/blackout-ios/capacitor.config.ts:21` |
| Apple bundle id | `com.blackout-trades.app` | `.github/workflows/blackout-ios-testflight.yml:65` (patched post-sync, `scripts/patch-ios-bundle-id.mjs`) |
| Apple Team ID | `ZA32C782N5` | `blackout-ios-testflight.yml:66` |
| ASC app Apple ID | `6787797476` | `blackout-ios-testflight.yml:69` |
| App name | `BlackOut` | `capacitor.config.ts:22` |
| Brand canvas | `#040407` | `capacitor.config.ts:58`, `src/app/layout.tsx:68` |
| UA detection token | `BlackOutiOSApp` | `capacitor.config.ts:27` |

The native app **keeps `com.blackout-trades.app`** as its bundle id (same ASC record, same
TestFlight lineage) so the migration is an app *update*, not a new SKU.

---

## 2. Architectural principles

1. **The server is the source of truth; the app is a rendering + interaction client.** All market
   math, dealer-gamma aggregation, BIE grading, and entitlement decisions already live server-side
   (`src/features/*`, `src/lib/*`, `src/app/api/*`). The native app must **not** re-implement any of
   it — it consumes the same JSON the web client consumes. This is a hard rule: a second copy of the
   0DTE gating or GEX math on the client is a correctness liability (see the repo's data-hygiene rule
   about rounding malformed floats *at the data layer*, `CLAUDE.md`).
2. **Unidirectional data flow.** `Repository → ViewModel (@Observable) → SwiftUI View`. Views never
   touch the network; view models never touch `URLSession` directly.
3. **Protocol-first, testable seams.** Every repository is a protocol with a live implementation and
   a fixture implementation, so the primary dev loop (GitHub Actions macOS runners, Section 14) can
   run XCTest + snapshot tests against recorded JSON with no secrets and no network.
4. **Progressive disclosure is an architecture concern, not just UI.** Per `PRODUCT-VISION.md §5`,
   the home surface answers "what matters now?"; a tap answers "why?"; another tap shows the numbers.
   That maps to lazy repositories and paginated/deferred detail loads, not one giant payload.
5. **Native capabilities are first-class, not advertised-but-unwired.** Face ID, APNs, share, deep
   links, widgets — each ships wired or it doesn't ship (the exact gap the 4.2 audit flags).

---

## 3. Layered architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Presentation           SwiftUI views + @Observable view models    │
│                         NavigationStack per tab, sheets, widgets    │
├──────────────────────────────────────────────────────────────────┤
│  Domain                 Value types (Play, GexLadder, Regime,       │
│                         FlowAlert, PulseSnapshot…), use-cases        │
├──────────────────────────────────────────────────────────────────┤
│  Data / Repositories    SpxRepository, VectorRepository,            │
│                         FlowRepository, ThermalRepository,          │
│                         LargoRepository, NightHawkRepository,        │
│                         EntitlementRepository, PushRepository        │
├──────────────────────────────────────────────────────────────────┤
│  Infra                  APIClient (REST), SSEClient (streams),       │
│                         AuthStore (Keychain), TierCache,             │
│                         KeychainStore, AppEnvironment (DI)           │
└──────────────────────────────────────────────────────────────────┘
```

Each layer only depends on the layer below it, expressed as a protocol. `AppEnvironment` (Section 6)
is the single composition root that wires concrete infra into repositories and injects them via the
SwiftUI environment.

---

## 4. Language, frameworks, minimum target — **PROPOSED**

| Choice | Decision | Rationale |
|---|---|---|
| Language | **Swift 6**, strict concurrency | Compile-time data-race safety for the many concurrent streams (SSE + SWR-style polls). |
| UI | **SwiftUI** (UIKit only for interop escape hatches) | Matches the "Apple design-award shelf" bar in `PRODUCT-VISION.md §7`. |
| Concurrency | **async/await + structured concurrency + `AsyncSequence`** | SSE maps cleanly to an `AsyncThrowingStream`; polls map to `Task` + `Task.sleep`. |
| State | **Observation (`@Observable`, `@Bindable`)**, iOS 17+ | Replaces `ObservableObject`/`@Published`; finer-grained invalidation for high-frequency tape/ladder updates. |
| Navigation | **`NavigationStack` + type-safe `NavigationPath`** | Deep-link/push-alert routing requires programmatic path control (Section 11). |
| Charting | **Swift Charts** for stat/level overlays; **Metal/`CAMetalLayer` or a custom `Canvas`** for the high-frequency candle + gamma-wall rail | The web Vector chart is a hand-rolled canvas (`src/features/vector/components/VectorChart.tsx`) precisely because it must redraw fast; Swift Charts is fine for sparse overlays but not the 1s wall-rail. |
| Minimum OS | **iOS 17.0** | Required for Observation + modern `NavigationStack`/`ScrollView` APIs; covers the professional-trader install base. |
| Dependencies | **First-party only where possible.** No analytics/tracker SDKs — the privacy audit confirms none exist today and the App-Privacy label depends on that staying true (`docs/ios/NATIVE-VALUE-AND-PRIVACY-AUDIT.md §B`). |

**Package layout — PROPOSED** (SPM local packages so CI compiles domain/data without the app target):

```
BlackOut.xcodeproj (or Tuist/XcodeGen-generated project — keep .pbxproj out of hand-merge hell)
  App/                 @main, AppEnvironment, RootTabView, routing
  Packages/
    BlackOutDomain/    pure value types + use-cases (no I/O) — 100% unit-testable, no secrets
    BlackOutData/      repositories + APIClient + SSEClient (depends on Domain)
    BlackOutAuth/      AuthStore, Keychain, SIWA, tier cache
    BlackOutUI/        design-system primitives (tokens, marks, tab bar, sheets)
    BlackOutFeatures/  one module per desk: Spx, Helix, Thermal, Largo, NightHawk, Vector, Account
  Widgets/             WidgetKit extension (Section 11)
  Tests/               unit + snapshot targets per package
```

Generating the project with **XcodeGen or Tuist** (**PROPOSED**) matters specifically for this repo:
there is no committed `.pbxproj` today, CI regenerates the Capacitor project each run, and a
hand-edited `.pbxproj` is the classic merge-conflict source for an agent-driven repo. A declarative
project spec keeps the native project reproducible the same way `capacitor.config.ts` is.

---

## 5. Repository pattern — grounded in the real endpoints

Each web feature already fetches through a thin client (`src/lib/api.ts`) that hits `/api/market/*`
(REST base `MARKET_BASE = "/api/market"`, `api.ts:5`) and `/api/engine/*` (`INTEL_BASE`, `api.ts:4`)
with `cache: "no-store"` and `credentials: "same-origin"` (`api.ts:6-20`). The native repositories
mirror that surface one-to-one. There are **163 API routes** total (`src/app/api/**/route.ts`), 58 of
them under `/api/market`. Representative mapping (**all endpoints EXISTING**):

| Native repository | Reads (REST) | Streams (SSE) | Web reference |
|---|---|---|---|
| `SpxRepository` | `/api/market/spx/desk`, `/spx/merged`, `/spx/play`, `/spx/pulse`, `/spx/pin`, `/spx/power-hour`, `/spx/bootstrap` | `/api/market/spx/pulse/stream` | `src/features/spx/hooks/*`, `src/hooks/usePulseStream.ts` |
| `FlowRepository` (HELIX) | `/api/market/flows`, `/flow-brief`, `/dark-pool`, `/anomalies` | `/api/market/flows/stream` | `src/features/helix/components/FlowFeed.tsx`, `api.ts:699` `createFlowEventSource` |
| `ThermalRepository` | `/api/market/gex-heatmap`, `/heatmap`, `/gex-positioning`, `/gex-heatmap/explain` | `/api/market/gex-matrix-deltas` | `src/features/thermal/components/GexHeatmap.tsx` |
| `LargoRepository` | `/api/market/largo/session` | `/api/market/largo/query?stream=1` (SSE POST) | `api.ts:498`, `src/features/largo/answer/BieAnswer.tsx` |
| `NightHawkRepository` | `/api/market/nighthawk/edition`, `/nighthawk/hunt`, `/nighthawk/record`, `/zerodte/board` | `/api/market/zerodte/marks/stream` | `src/features/nighthawk/hooks/useZeroDteLiveMarks.ts` |
| `VectorRepository` | `/api/market/vector/{bars,walls,gex-ladder,max-pain,expected-move,flow,prior-day,wall-history,universe}` | `/api/market/vector/stream` | `src/features/vector/*`, `api.ts:798` `createVectorEventSource` |
| `MarketRepository` (shared) | `/api/market/indices`, `/quote`, `/regime`, `/news`, `/ticker-search`, `/platform/snapshot`, `/health` | — | `api.ts:162`, `src/lib/api.ts` |
| `EntitlementRepository` | derived from session claims + `/account` data | — | `src/lib/tier-cache.ts`, `src/lib/auth-access.ts` |

Repository protocol shape (**PROPOSED**):

```swift
protocol SpxRepository: Sendable {
    func desk() async throws -> SpxDesk                 // REST snapshot
    func play() async throws -> SpxPlay?                // graded read
    func pulseStream() -> AsyncThrowingStream<PulseSnapshot, Error>  // SSE overlay
}
```

**Snapshot-then-overlay is the load-bearing pattern**, copied from the web app verbatim: fetch a REST
snapshot for correctness, then merge a live SSE overlay on top for immediacy. `usePulseStream.ts`
does exactly this — `overlayFromStream()` (`usePulseStream.ts:13-55`) merges live Polygon index
prices over the REST desk pulse; the native `SpxViewModel` merges `PulseSnapshot` deltas over the
`SpxDesk` snapshot identically. Do not diverge from this contract — it is why the app never blanks
between a poll and a stream tick.

---

## 6. Dependency injection

**PROPOSED:** a single `AppEnvironment` composition root, injected through the SwiftUI environment.
No service locator, no global singletons for anything testable.

```swift
@Observable final class AppEnvironment {
    let api: APIClient
    let sse: SSEClient
    let auth: AuthStore
    let spx: any SpxRepository
    let vector: any VectorRepository
    // …one per desk + entitlement + push

    static func live() -> AppEnvironment { /* real URLSession + Keychain */ }
    static func preview() -> AppEnvironment { /* fixture repos over recorded JSON */ }
}
```

`AppEnvironment.preview()` is what unlocks the **secretless CI loop** (Section 14): snapshot tests
render every screen against `preview()` repos backed by committed JSON fixtures, so GitHub Actions
macOS runners validate the full UI with no Clerk user, no market data, no network.

---

## 7. Networking — REST + SSE (WebSockets are deliberately not used client-side)

### 7.1 The proxy/WS reality (why SSE, not WS)

WebSocket upgrades are blocked by the agent proxy in this sandbox, and — more importantly for the
production architecture — **the UW/Polygon WebSockets already run server-side on AWS ECS**; the
browser never opens a market WebSocket. The client receives real-time data via **SSE + SWR-style
polling** (`CLAUDE.md` environment realities; middleware even excludes `upgrade: websocket` requests,
`src/middleware.ts:14-25`). The native app **inherits this exact model**: it consumes the same SSE
endpoints and REST snapshots. It does **not** open its own market WebSocket. This is both a sandbox
constraint and the correct production design — fan-out and provider auth stay server-side.

### 7.2 `APIClient` (REST) — **PROPOSED**, mirrors `marketFetch`/`intelFetch`

```swift
actor APIClient {
    private let session: URLSession
    private let base: URL              // https://blackouttrades.com
    private let auth: AuthStore

    func get<T: Decodable>(_ path: String) async throws -> T { … }
    func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T { … }
}
```

Contract details copied from the web client so responses decode identically:
- **No-store semantics.** Web sends `Cache-Control: no-cache` / `Pragma: no-cache` (`api.ts:11-13`);
  native uses `URLRequest.cachePolicy = .reloadIgnoringLocalCacheData`.
- **Credentials.** Web relies on the same-origin `__session` cookie (`api.ts:9`). Native attaches the
  session as a cookie/bearer via `AuthStore` (Section 8), not `URLSession`'s shared cookie jar.
- **Error mapping.** Web throws on `!res.ok` with the status (`api.ts:18`). Native maps HTTP status to
  a typed `APIError` and — critically — treats **503 as retryable** and **403 as "upgrade required"**
  distinctly, because `requireTierApi` returns those with different meaning (503 = transient tier
  lookup failure, 403 = genuinely not entitled; `src/lib/market-api-auth.ts:44-58`). Conflating them
  would either kick out a paying user on a transient blip or silently hide an upgrade wall.
- **Number hygiene.** Decode monetary/price fields as `Double` then format at the presentation layer
  to a sane precision — never echo a raw float like `7499.360000000001` (repo data-hygiene rule,
  `CLAUDE.md`). Formatting helpers mirror `fmtPrice`/`fmtPct` (`api.ts:860-871`).

### 7.3 `SSEClient` (streams) — **PROPOSED**, mirrors `createReconnectingEventSource`

The web SSE client (`api.ts:640-697`) is a reconnecting `EventSource` with **exponential backoff from
1s to a 30s cap** and an `onOpen`/`onClose` hook contract that only signals "closed" if the connection
had actually opened (so an initial connect failure doesn't trigger a spurious REST refetch,
`api.ts:670-683`). The native `SSEClient` reproduces this exactly using `URLSession.bytes(for:)`:

```swift
func stream(_ path: String) -> AsyncThrowingStream<SSEEvent, Error> {
    // URLSession.bytes → parse `data:` lines → yield; on drop, backoff 1s→30s and reconnect.
    // Only emit a `.closed` transition after a successful `.open` (parity with api.ts:670-683).
}
```

There are **8 SSE routes** to support: `flows/stream`, `spx/pulse/stream`, `vector/stream`,
`zerodte/marks/stream`, `gex-matrix-deltas`, `largo/query` (streamed answer), `admin/apis/stream`,
and the marks stream (`src/app/api/market/**/route.ts`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`).
Server-side these are tier-gated (`vector/stream` calls `authorizeMarketDeskApi` + `requireToolApi`,
`src/app/api/market/vector/stream/route.ts:23-27`) and connection-capped
(`SSE_MAX_STREAMS`, default 2000). The native client must therefore:
- **Cancel streams on background/lock.** iOS suspends the app; a held SSE connection wastes a server
  slot. Tear down on `scenePhase == .background`, reconnect on `.active` (also the Face-ID resume
  gate seam, Section 8).
- **One stream per visible desk.** Never hold six streams for six tabs — only the foreground tab's
  stream is live, matching how the web app mounts one stream per active desk component.

### 7.4 Polling (SWR parity)

The web app uses SWR in **15 files** (`useSpxPlay`, `useMergedDesk`, `useSpxPin`, `useSpxLotto`,
`VectorScanner`, `VectorPulse`, `GexHeatmap`, etc.) for data that refreshes on a cadence rather than a
stream (e.g. `VECTOR_GEX_HEATMAP_POLL_MS`, `src/features/vector/lib/vector-cadence.ts`). Native
equivalent (**PROPOSED**): a small `PolledResource<T>` actor = `Task` loop with `Task.sleep`,
`revalidateOnForeground`, and dedupe — the SWR feature-set that matters here (stale-while-revalidate,
focus revalidation, interval), not a full SWR clone. Cadences come from the same server-provided
constants where exposed so web and native refresh in lockstep.

---

## 8. Authentication

### 8.1 Today (EXISTING)

Auth is **Clerk** in prod (`@clerk/nextjs`), abstracted behind a provider-neutral seam
(`src/lib/auth-server.ts` `getSession()` returns `{userId, email, sessionClaims}` for Clerk *or*
Cognito — staging uses Cognito). Session is the `__session` JWT cookie + `__client_uat` epoch cookie.
Server code reads it via Clerk's `auth()`; a decode-only fallback exists for edge cases
(`src/lib/clerk-session-jwt.ts` — reads `sub`/`exp`/`sts` from the JWT payload, never trusts it for
authorization). The WKWebView shell today simply lets Clerk's web SDK manage the cookie inside the
web view; there is **no native auth**.

The headless prod-login flow already proven for audits is the template for native token acquisition:
mint a Backend-API `sign_in_token` → exchange the ticket at FAPI `clerk.blackouttrades.com`
(`_clerk_js_version=5.57.0`) → receive a `__session` JWT (`CLAUDE.md` "Access reality" item 1;
`scripts/audit/data-validator.mjs`).

### 8.2 Native auth plan — **PROPOSED**

The native app must own its session rather than lean on a web view's cookie jar:

1. **Primary sign-in: Clerk-native.** Use Clerk's iOS SDK (or a thin native client against the same
   FAPI ticket-exchange flow the audit login uses) to obtain the `__session` JWT + a refresh handle.
   Keep the provider seam: an `AuthProvider` protocol with a `ClerkAuthProvider` today, so a future
   Cognito path (staging already uses Cognito, `src/middleware-cognito.ts`) is a swap, not a rewrite —
   exactly the abstraction `getSession()` already encodes server-side.
2. **Sign in with Apple (SIWA) — MISSING, required.** App Store Guideline 4.8 requires SIWA whenever
   a third-party/social login is offered. Wire `ASAuthorizationController`; on the server, add a
   Clerk SIWA connection (or a `/api/auth/apple` exchange) that maps the Apple credential to the same
   Clerk user identity, so entitlements (Section 9) resolve unchanged. SIWA also gives the cleanest
   "Hide My Email" story for the privacy label.
3. **Keychain persistence — MISSING.** Store the session + refresh material in the Keychain with
   `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (survives relaunch, never syncs, never leaves
   the device). Never `UserDefaults`. `AuthStore` is the only component that reads/writes it.
4. **Refresh rotation — MISSING.** Clerk session JWTs are short-lived (the decode path checks `exp`,
   `clerk-session-jwt.ts:40-45`). `AuthStore` refreshes proactively before `exp`, serializes
   concurrent refreshes (single-flight `Task`), and on hard 401 clears the Keychain and routes to
   sign-in. A rotated refresh token replaces the stored one atomically.
5. **Face ID / biometric app-lock — MISSING (advertised in `capacitor.config.ts:9-12`, never wired).**
   Use `LocalAuthentication` (`LAContext`, `.deviceOwnerAuthenticationWithBiometrics`). Gate **app
   resume** (on `scenePhase → .active` after a threshold in background) behind a successful evaluation,
   with a passcode fallback and an Account toggle. This is the `N-1` backlog item
   (`docs/ios/IOS-PREMIUM-PROGRAM.md`) done properly in native code. The biometric gate protects the
   *desk view*, not the token — the token stays in the Keychain regardless.

**Auth flow (native):**

```
Launch → AuthStore.restore() (Keychain)
   ├─ valid session  → (biometric gate if enabled) → RootTabView
   ├─ expired, refreshable → silent refresh → RootTabView
   └─ none/invalid   → SignInView (Clerk-native or Sign in with Apple)
```

---

## 9. Entitlements (tier / membership) — server-enforced, EXISTING

Entitlements are **already server-enforced and must stay that way** — the client only *reflects*
them. The model (all EXISTING):

- **Tiers** are `free | premium` (`src/lib/tiers.ts`); `premium` is granted by `pro`/`elite` too
  (`parseTier`, `tiers.ts:8-11`). Tier comes from Clerk `publicMetadata.tier`, which is **Whop-driven**
  and cached ~60s (`src/lib/tier-cache.ts`, `CLAUDE.md` auth model).
- **Access classification** (`src/lib/admin-user-access.ts` `classifyAdminUserAccess`): `admin` (tier
  bypass), `premium` (full desk), `community` ($75 — **Discord only, no web desk**,
  `admin-user-access.ts:30-35`), `free` (marketing + `/upgrade` only). The native app must render the
  **community** case honestly: a $75 community member has an account but **no desk access** — the app
  should show a "membership managed on the web" state, not a broken desk.
- **Page gate:** `requireTier(minTier)` redirects non-entitled users to `/upgrade`
  (`src/lib/auth-access.ts:29-43`); admins bypass (`isAdminUser`, `src/lib/admin-access.ts:11-26`).
- **API gate:** every market desk route calls `requireTierApi` / `authorizeMarketDeskApi`
  (`src/lib/market-api-auth.ts:27-59`), returning **401** (no session), **403** ("upgrade required"),
  or **503** (tier lookup transiently unavailable — retry, don't sign out).

**Native contract — PROPOSED:**
- `EntitlementRepository` resolves tier from session claims (fast path) with a REST fallback, cached
  locally with the same ~60s TTL so the app and server agree.
- **The client never grants access.** It uses tier only to choose which surface to render (desk vs
  upgrade-wall vs community-note). Every data call still hits a server-gated endpoint; a client that
  wrongly believes it's premium simply gets a 403 and shows the wall. Server is the authority.
- **3.1.1 compliance carries over.** The app sells nothing and links to no checkout
  (`capacitor.config.ts:14-16`; `docs/ios/COMPLIANCE-3.1.1-AUDIT.md`). Native views render an upgrade
  *wall* ("membership managed on the web") with **no price and no purchase link** — the same neutral
  pattern the web `SpxDashboard` uses in-app (`src/features/spx/components/SpxDashboard.tsx:139-170`).
  See Section 10 on why StoreKit is deliberately *not* adopted.

---

## 10. StoreKit 2 — deliberate NON-adoption (documented decision)

**Decision: no In-App Purchase, no StoreKit 2 for subscriptions.** The product is the
Netflix/Spotify "reader" model — users subscribe on the web via Whop; the app is sign-in-only
(`apps/blackout-ios/capacitor.config.ts:14-16`). This is both a compliance posture (avoids 3.1.1
external-purchase violations) and a business one (avoids Apple's 15–30% cut). The native app inherits
this: **no purchase UI, no `Product`, no `Transaction` for tiers.** `*.whop.com` is deliberately off
the navigation allow-list (`capacitor.config.ts:45-53`; `P0-4` done, `docs/ios/EXECUTION-STATE.md:34`).

StoreKit 2 is listed here only to record the decision explicitly so a future contributor doesn't
"helpfully" add IAP. The *only* future scenario that would revisit this is a purely-additive digital
good sold in-app (none exists today); tier/membership stays external.

---

## 11. Platform capabilities

### 11.1 Push / APNs — **MISSING today; the flagship native feature**

Today push is **web-push only** and **inert in the WKWebView** (`src/lib/push-client.ts`,
`public/sw.js`, table `push_subscriptions(endpoint PK, user_id, p256dh, auth, created_at)` in
`src/app/api/push/subscribe/route.ts:10-18`). Web Push does not function inside a Capacitor WKWebView,
so no APNs token is ever requested (`docs/ios/NATIVE-VALUE-AND-PRIVACY-AUDIT.md`).

**Native APNs plan — PROPOSED:**
1. **Register natively.** `UIApplication.registerForRemoteNotifications()` +
   `UNUserNotificationCenter` for permission and presentation (config already sets
   `presentationOptions: ["badge","sound","alert"]`, `capacitor.config.ts:69-71`). The Capacitor
   `@capacitor/push-notifications` plugin is a *dependency already* (`package.json:19`) but never
   called — a full-native app calls the APIs directly; a transitional hybrid would call the plugin.
2. **New token table — MISSING (parallel to `push_subscriptions`).** Add `apns_device_tokens`:
   `device_token TEXT PK, user_id TEXT NOT NULL, environment TEXT ('sandbox'|'production'),
   bundle_id TEXT, app_version TEXT, created_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ`. Follow the
   exact IDOR-safe upsert the web-push route uses — on conflict, refresh only when the token already
   belongs to the same `user_id` (`push/subscribe/route.ts:49-56`); never reassign ownership.
3. **Server sender — MISSING.** A server module signs APNs JWTs (ASC/APNs `.p8` key, same key-mgmt
   discipline as the TestFlight signing secrets) and fans out the same alert events that would drive
   web push — GEX regime flips, 0DTE gate clears, Night Hawk fires. Alert *content* already exists
   (Night Hawk "alerts when gates clear", `PRODUCT-VISION.md §6`); this is a new transport.
4. **Actionable deep links — MISSING.** Each push carries a route (`spx`, `vector?ticker=NVDA`,
   `nighthawk`) resolved through the same registry as the tab bar (`src/lib/ios-tool-routes.ts`
   `getIosRouteKey`), pushing onto the target tab's `NavigationPath`. This makes the alert land on the
   exact desk — the difference between a notification and a *useful* one.

### 11.2 WidgetKit — **PROPOSED (net-new native value)**

Home-screen / Lock-screen widgets are pure native value the web app can never provide and directly
serve the "one glance" north star (`PRODUCT-VISION.md §7`). Candidates, each backed by an EXISTING
endpoint:
- **SPX posture widget** — spot, regime, and today's graded play direction/invalidation from
  `/api/market/spx/play` + `/spx/pulse`.
- **Vector regime widget** — a watched ticker's regime line + flip + max-pain from
  `/api/market/vector/{walls,max-pain,gex-ladder}`.
- **Night Hawk widget** — top graded overnight play + morning-confirm status from
  `/api/market/nighthawk/edition`.

Widgets refresh via `TimelineProvider` on a budget-friendly cadence (respect the same RTH cadences;
never poll a stream from a widget). A shared **App Group** lets the app hand the widget a last-known
snapshot so it renders instantly even before its own timeline fetch.

### 11.3 ActivityKit (Live Activities) — **PROPOSED**

A Live Activity on the Lock Screen / Dynamic Island for an **active SPX 0DTE play** — spot vs
entry/target/stop/invalidation, updated via APNs push-to-start + `ActivityKit` token updates. This is
the single highest-impact "professional equipment" flourish for a trader watching a play develop, and
it reuses the same play object (`src/features/spx/lib/spx-play-thesis.ts`) and APNs channel (11.1).
Gate it strictly to a *live, graded* play so it never becomes a "signal feed" (the anti-pattern in
`PRODUCT-VISION.md §4`).

### 11.4 Sign in with Apple — see Section 8.2 (required for App Store when any social login exists).

### 11.5 Haptics — **EXISTING pattern to port**

The web shell already fires selection/impact haptics through the Capacitor bridge
(`src/lib/ios-haptics.ts`, called from the tab bar and native menu). Native replaces the bridge with
`UIImpactFeedbackGenerator` / `UISelectionFeedbackGenerator` on the same interactions (tab switch,
lens toggle, sheet open), keeping the tactile contract described in `PRODUCT-VISION.md §3` ("Speed").

### 11.6 Share, deep links, status bar

- **Share (MISSING):** native `ShareLink` / `UIActivityViewController` for a chart or play snapshot —
  a genuine native affordance the shell lacks (`@capacitor/share` isn't even a dependency).
- **Deep links (PARTIAL→native):** `@capacitor/app` is a dependency but unused; native uses Universal
  Links + `onOpenURL` routed through the tab registry (shared with push routing, 11.1).
- **Status bar (PARTIAL→native):** the shell relies on a meta tag and never calls the StatusBar plugin
  (`NATIVE-VALUE-AND-PRIVACY-AUDIT.md`); native controls appearance directly per screen (dark chrome,
  `#040407`).

---

## 12. Local persistence, caching, offline

- **Session/secrets:** Keychain only (Section 8).
- **Snapshots for instant cold-start:** cache the last desk/vector/play REST snapshot to disk
  (`SwiftData` or a small `Codable` file cache) keyed by ticker/DTE, shown immediately on launch with
  a freshness chip (the web app has this concept — `FreshnessChip`,
  `src/features/vector/components/VectorPageShell.tsx:6`) while the live fetch/stream catches up.
- **Offline state (EXISTING pattern):** the shell has a static reconnect splash
  (`apps/blackout-ios/www/index.html`); native shows a proper offline state per surface with the
  last cached snapshot + "reconnecting", never a blank or a spinner-forever.
- **No sensitive market payload persisted longer than needed** — snapshots are convenience cache, not
  a datastore; they expire and are cleared on sign-out alongside the Keychain.

---

## 13. Observability

- **Crash/error (EXISTING, mirror it):** the server uses Sentry **only if `SENTRY_DSN` is set**,
  server-side, with no user identity attached and no session replay
  (`src/lib/error-sink.ts`; `NATIVE-VALUE-AND-PRIVACY-AUDIT.md §B`). The native app may add
  MetricKit + (optionally) the same Sentry project **without** `setUser`/PII and **without** session
  replay, to keep the App-Privacy label as "Diagnostics — Not Linked". If that discipline can't be
  guaranteed, ship MetricKit-only.
- **No third-party analytics/tracker SDK** — the audit confirmed none exist and the label depends on
  it (`NATIVE-VALUE-AND-PRIVACY-AUDIT.md §B`). Product analytics stay server-side.
- **Structured logging** via `OSLog`/`Logger` with subsystem per package; never log tokens or PII.

---

## 14. Build & test strategy — the constraint that shapes everything

**This is a Linux sandbox: no local Mac, no local Xcode** (`docs/ios/EXECUTION-STATE.md`). Native iOS
is *written here* and *compiled/tested remotely*. The strategy has three tiers:

### 14.1 PRIMARY loop — GitHub Actions macOS runners (no quota, no secrets) — **EXISTING channel**

This is the autonomous build/test loop. Confirmed working via the GitHub MCP channel (list/trigger
workflows, read job logs + artifacts, `docs/ios/EXECUTION-STATE.md:9-14`). Compiling Swift, running
XCTest, and rendering **snapshot tests need no AWS quota and no signing secrets** — push code + a
macOS CI workflow, trigger it, read results + snapshot PNGs as artifacts.

**PROPOSED CI job `native-ios-ci` (`.github/workflows/native-ios-ci.yml`):**
```
runs-on: macos-14            # same runner family as the existing TestFlight workflow
steps:
  - checkout
  - select Xcode (xcode-select) / mise-pinned toolchain
  - (Tuist/XcodeGen) generate project
  - xcodebuild build-for-testing  -scheme BlackOut -destination 'platform=iOS Simulator,name=iPhone 15 Pro'
  - xcodebuild test-without-building  (XCTest: Domain + Data + Auth unit tests)
  - snapshot tests over AppEnvironment.preview()  → upload failure diffs as artifacts
  - upload .xcresult + snapshot PNGs as artifacts   (readable via the MCP channel)
```
Because tests run against `AppEnvironment.preview()` (Section 6) over **committed JSON fixtures**, this
job needs **zero secrets and zero live market/Clerk access** — it validates the entire UI + domain
logic hermetically. This mirrors how the existing pipeline already gates the expensive Mac job behind
a free Linux `validate-config` step (`blackout-ios-testflight.yml:46-51`).

**Fixtures come from the real contracts:** capture live JSON once from the endpoints in Section 5
(the audit login already fetches authenticated endpoints headlessly, `CLAUDE.md` access item 1),
sanitize, commit under `Tests/Fixtures/`. Keeps native decoders honest against the *actual* server
shapes without a live dependency in CI.

### 14.2 ACCELERATOR — AWS EC2 Mac (quota pending) — **PARTIAL**

Owner supplied AWS creds (account `177922194517`, session-local, never committed). All Mac host
quotas were 0; a quota increase for `Running Dedicated mac2 Hosts` (L-5D8DADF5 → 1) is **PENDING AWS
review** (`docs/ios/EXECUTION-STATE.md:14-16`). When granted → interactive Xcode over SSH, faster
iteration, and local signing. This is an accelerator, **not** on the critical path — the GitHub
Actions loop is fully sufficient to build the app.

### 14.3 RELEASE — signing + TestFlight — **EXISTING**

`.github/workflows/blackout-ios-testflight.yml` already builds+signs+ships the *Capacitor* shell and
is the template for the native release job. It: validates config on Linux → on `macos-14` installs
`codemagic-cli-tools`, generates the project, sets a strictly-increasing `CFBundleVersion`
(`get-latest-testflight-build-number`, lines 120-136), fetches/creates the distribution cert +
provisioning profile via the **ASC API key** (`scripts/codemagic-signing.sh`), builds the IPA, and
`app-store-connect publish`es to TestFlight. Signing uses **3 GitHub secrets**
(`APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_PRIVATE_KEY`, lines
10-14) — **names committed, values never**. Codemagic (root `codemagic.yaml`, `mac_mini_m2`,
integration "BlackOut ASC") is the parallel primary path; both share one signing story.

**For native:** the same signing step and secrets apply unchanged — swap the Capacitor
generate/sync steps for the Tuist/XcodeGen generate + `xcodebuild archive`. **The owner's one manual
action stays the same:** inject the ASC API key once (Codemagic integration *or* the 3 GitHub
secrets); after that, build + submit run autonomously (`docs/ios/IOS-PREMIUM-PROGRAM.md` SHIP item).

### 14.4 Testing pyramid — **PROPOSED**

| Layer | Tool | Runs where | Needs secrets? |
|---|---|---|---|
| Domain unit tests (math, formatting, regime derivation, thesis/invalidation) | XCTest | GH Actions | No |
| Decoder/contract tests (server JSON → domain types, over committed fixtures) | XCTest | GH Actions | No |
| Repository tests (retry/backoff, 401/403/503 mapping, SSE reconnect parity) | XCTest + `URLProtocol` stub | GH Actions | No |
| Snapshot tests (every screen, light-canvas dark theme, loading/empty/error states) | swift-snapshot-testing | GH Actions | No |
| UI/integration smoke (nav, tab switch, deep-link routing) | XCUITest on Simulator | GH Actions | No |
| Live contract drift check (periodic: fetch real endpoints, assert shapes) | XCTest against staging/prod | scheduled, EC2 Mac or gated GH job | Yes (audit login) |

The first five are the everyday loop and require nothing but the runner. The last catches server
contract drift and reuses the existing headless audit-login machinery.

---

## 15. WebView → native migration plan

**Strategy: strangler-fig, per surface, highest-value-first.** The Capacitor shell stays the shipping
vehicle and the *fallback* while native surfaces land one at a time. Each surface is "done native"
only when it (a) renders from the repository over the real endpoint, (b) passes snapshot + contract
tests, and (c) matches the design-system bar. The hybrid never regresses — a native surface that
isn't ready simply keeps loading the web view.

### 15.1 Per-feature migration table

| Surface | WebView today (source) | Native target | Sequence |
|---|---|---|---|
| **App chrome / tab bar / header / menu** | `src/components/ios/*`, `src/components/IosAppTabBar.tsx`, `src/lib/ios-tool-routes.ts` | `RootTabView` + `NavigationStack` per tab, native header/menu, haptics via `UIFeedbackGenerator` | **Phase 1** — the frame everything else fills |
| **Auth (sign-in, session)** | Clerk web SDK inside WKWebView | Clerk-native + SIWA + Keychain + Face ID (Section 8) | **Phase 1** — native shell needs a native session |
| **Account** | `/account` web page | `AccountView` (profile, membership state, Face-ID toggle, notif prefs) | **Phase 2** |
| **SPX Slayer** (anchor desk) | `/dashboard`, `src/features/spx/*` | `SpxView` over `SpxRepository` (desk + play + pulse SSE overlay) | **Phase 2** — flagship first |
| **Vector** (charting engine) | `/vector`, `src/features/vector/*` (canvas chart) | `VectorView` + Metal/Canvas chart + gamma-wall rail over `VectorRepository` (`vector/stream`) | **Phase 3** — hardest (custom rendering); SPX embeds it |
| **HELIX (flows)** | `/flows`, `src/features/helix/*` | `FlowView` — native list over `flows/stream` (`createFlowEventSource` parity) | **Phase 3** |
| **Thermal (heatmap)** | `/heatmap`, `src/features/thermal/GexHeatmap.tsx` | `ThermalView` — native GEX surface over `gex-matrix-deltas` | **Phase 4** |
| **Night Hawk** | `/nighthawk`, `src/features/nighthawk/*` | `NightHawkView` — ranked plays + morning-confirm over `nighthawk/edition` | **Phase 4** |
| **Largo (analyst)** | `/terminal`, `src/features/largo/answer/BieAnswer.tsx` | `LargoView` — streamed `BieAnswerEnvelope` over `largo/query?stream=1` | **Phase 4** |
| **FAQ / Learn** | `/faq`, `/learn/**` | Native static/markdown views (or keep as in-app web content) | **Phase 5** (low churn; acceptable to keep web-backed) |
| **Upgrade / membership wall** | `/upgrade` (neutralized in-app) | Native "managed on the web" wall, **no price/link** (Section 9/10) | **Phase 2** (rendered wherever a gate hits) |
| **Push / alerts** | web-push (inert in WKWebView) | Native APNs + deep-link routing + Live Activity (Section 11) | **Phase 2–3**, parallel |
| **Widgets** | none | WidgetKit (Section 11.2) | **Phase 3+**, parallel |
| **Track-record** | `/track-record` (no native chrome today — a known gap, `IOS-PREMIUM-PROGRAM.md` U-8) | `TrackRecordView` (append-only performance record) | **Phase 5** |

### 15.2 Sequencing rationale

1. **Phase 1 — Foundation:** native shell (tab/nav/header/menu) + native auth + DI + networking
   (`APIClient`/`SSEClient`) + entitlement resolution + the secretless CI/snapshot loop. Nothing
   user-visible ships yet beyond the frame; this is the scaffolding every later phase reuses.
2. **Phase 2 — Anchor + account + alerts:** SPX Slayer (the flagship decision surface,
   `PRODUCT-VISION.md §6`), Account, the upgrade wall, and native APNs. Proves the snapshot-then-SSE
   pattern end-to-end on the most important desk.
3. **Phase 3 — Charting + flow:** Vector (the hardest — custom high-frequency rendering — and the
   engine SPX embeds) and HELIX. Widgets can land in parallel once SPX/Vector repositories exist.
4. **Phase 4 — Remaining desks:** Thermal, Night Hawk, Largo — each a repository + view over existing
   endpoints, now routine because the patterns are set.
5. **Phase 5 — Long tail:** Track-record, FAQ/Learn. These are low-churn and acceptable to keep
   web-backed inside a native frame longer, retiring the WebView entirely only when they're ported.

**Coexistence contract:** during migration, `RootTabView` decides per-tab whether to present the
native view or an embedded `WKWebView` of the corresponding route. A single feature flag per surface
(local, later remote) flips a tab to native once its tests are green — so migration ships
incrementally and any native regression is a one-flag rollback to the proven web surface.

---

## 16. Cross-cutting rules (non-negotiable)

- **Never re-implement server math on the client** (Section 2). Consume JSON; format at the edge.
- **Round/format numbers at the presentation layer**; never surface a raw float (`CLAUDE.md`).
- **One live stream per foreground desk**; tear down on background (Section 7.3) — server slots are
  capped (`SSE_MAX_STREAMS`).
- **Server is the entitlement authority** (Section 9); the client only reflects tier.
- **No purchase UI, no IAP, no checkout link, no price in-app** (Sections 9–10; 3.1.1).
- **No third-party tracker SDK**; keep the App-Privacy label truthful (Section 13).
- **Secrets never committed**; signing via ASC key / GitHub secrets at release only (Section 14.3).
- **Capabilities ship wired or not at all** — no advertised-but-unwired features (the 4.2 gap).

---

## 17. Open questions / risks

- **EC2 Mac quota (L-5D8DADF5)** still pending (`EXECUTION-STATE.md:14-16`) — non-blocking; GH Actions
  is sufficient, but interactive debugging is slower until it lands.
- **Clerk iOS-native session semantics** — validate the exact refresh/rotation API surface against the
  FAPI flow the audit login already uses (`CLAUDE.md` access item 1) before committing `AuthStore`.
- **APNs `.p8` key mgmt** — reuse the ASC key or provision a dedicated APNs key; either way, same
  never-commit discipline as the TestFlight secrets.
- **Chart engine** — decide Metal vs `Canvas` for the Vector wall rail after a spike; the web version's
  perf constraints (`VectorChart.tsx`) are the benchmark to beat, not match.
- **Server contract drift** — the app depends on ~58 market endpoints; the periodic live contract test
  (Section 14.4) is the guardrail, but any endpoint reshape must update fixtures + decoders in lockstep.

---

## 18. File reference index (ground truth cited above)

- Shell config: `apps/blackout-ios/capacitor.config.ts`, `apps/blackout-ios/package.json`
- iOS detection + chrome: `src/app/layout.tsx:80-84`, `src/lib/ios-app-shell.ts`,
  `src/components/ios/*`, `src/components/IosAppTabBar.tsx`, `src/lib/ios-tool-routes.ts`,
  `src/lib/ios-haptics.ts`
- Networking (REST + SSE): `src/lib/api.ts` (`marketFetch` 6, SSE factory 640, `createFlowEventSource`
  699, `createPulseEventSource` 739, `createVectorEventSource` 798), `src/hooks/usePulseStream.ts`
- SSE routes: `src/app/api/market/{flows,spx/pulse,vector,zerodte/marks}/stream/route.ts`,
  `src/app/api/market/gex-matrix-deltas/route.ts`, `src/app/api/market/largo/query/route.ts`
- Auth: `src/lib/auth-server.ts`, `src/lib/clerk-session-jwt.ts`, `src/middleware.ts`,
  `src/middleware-cognito.ts`, `src/lib/market-api-auth.ts`
- Entitlements: `src/lib/tiers.ts`, `src/lib/auth-access.ts`, `src/lib/tier-cache.ts`,
  `src/lib/admin-user-access.ts`, `src/lib/admin-access.ts`
- Push (web, today): `src/app/api/push/subscribe/route.ts`, `src/lib/push-client.ts`, `public/sw.js`
- CI / signing: `.github/workflows/blackout-ios-testflight.yml`, `codemagic.yaml`,
  `apps/blackout-ios/scripts/{codemagic-signing.sh,patch-ios-bundle-id.mjs,validate-config.mjs}`
- Companion docs: `docs/ios/PRODUCT-VISION.md`, `docs/ios/EXECUTION-STATE.md`,
  `docs/ios/IOS-PREMIUM-PROGRAM.md`, `docs/ios/NATIVE-VALUE-AND-PRIVACY-AUDIT.md`,
  `docs/ios/COMPLIANCE-3.1.1-AUDIT.md`, `docs/ios/ASC-METADATA.md`

---

*This is the technical foundation. It is measured against `docs/ios/PRODUCT-VISION.md §7`: the native
app is done when it could sit between Bloomberg and TradingView on the same home screen and belong
there. Architecture serves that bar — nothing here is decoration.*
