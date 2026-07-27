# INFORMATION-ARCHITECTURE.md — BlackOut native iOS (SwiftUI)

**Scope.** The information architecture for the *production-grade native SwiftUI* iOS app — the
target of the master prompt, not the current Capacitor WKWebView hybrid. This doc defines the
**5-tab shell**, every sub-screen under it, and — for each screen — its **job**, its **key
elements**, and the **real data source / route / API** it maps to in this repo. Everything here
is grounded in the actual codebase; where a surface does not exist yet it is marked **missing** or
**proposed**, never implied to exist.

**Companion docs (read alongside):**
`docs/ios/IOS-PREMIUM-PROGRAM.md` (backlog + architecture facts) ·
`docs/ios/EXECUTION-STATE.md` (hybrid-now / native-forward sequencing) ·
`docs/ios/NATIVE-VALUE-AND-PRIVACY-AUDIT.md` (native-capability wiring truth) ·
`docs/ios/COMPLIANCE-3.1.1-AUDIT.md` (no-pricing-in-app gate) ·
`docs/ios/ASC-METADATA.md` (store listing / desk value props).

---

## 0. Status taxonomy (used in every table below)

Because there is **no native SwiftUI app today** — the shipping iOS surface is a Capacitor 6
WKWebView loading prod (`apps/blackout-ios/capacitor.config.ts`, `server.url:
https://blackouttrades.com`) — "native" is almost always the *target*, not the present. Each screen
carries one status:

| Marker | Meaning |
|---|---|
| **exists-native** | A genuine native (Swift/Capacitor-plugin) implementation exists today. Realistically **only haptics** (`src/lib/ios-haptics.ts` bridge) meets this bar right now — see §7. |
| **partial** | The surface exists on the web AND already has **iOS-shell-specific adaptation** (an `ios-native*.css` treatment, a segmented mobile layout, native header/menu/tab entry via `src/lib/ios-tool-routes.ts`). A hybrid step toward native. |
| **exists-web-only** | The route/page exists and renders in the WKWebView, but has **no** iOS-specific treatment beyond the shared chrome. A straight web render. |
| **missing** | Needed by this IA (or by Apple) but has **no implementation at all** in the repo today. |
| **proposed** | A **net-new native screen** this IA introduces that has no direct 1:1 web route (e.g. the Command aggregator, the Signals inbox, the native Watchlist). Its *data* usually already exists via APIs; the *screen* does not. |

**Auth/tier reality that shapes every tab:** all six desks call `requireTier("premium")`
(`src/lib/auth-access.ts`) at the page layer, and most market APIs gate through
`authorizeMarketDeskApi` / `authorizeCronOrTierApi` / `requireToolApi`
(`src/lib/market-api-auth.ts`, `src/lib/tool-access-server.ts`). Per-tool launch gates
(`canAccessTool`) can hide Vector/Thermal/Largo/Night Hawk behind a `ComingSoon` state even for
premium users. The native app must mirror this: **tier + per-tool gate**, not a single boolean.

**Compliance constraint that shapes the Account tab + first launch:** per
`docs/ios/COMPLIANCE-3.1.1-AUDIT.md`, the app must render **zero** pricing / purchase / checkout UI.
The native app has an advantage here — it simply **does not build** those screens, rather than
CSS-hiding them. Membership is "managed on the web," sign-in only.

---

## 1. The 5-tab shell (native `TabView`)

The current hybrid tab bar is 5 *instruments* (`IOS_TOOLS` in `src/lib/ios-tool-routes.ts`:
`/dashboard /flows /heatmap /terminal /nighthawk`) with Vector as a non-tab native-chrome route.
The **native IA reorganizes** from "one tab per desk" to **five job-shaped tabs**, because six
co-equal desk tabs plus utilities do not fit a Bloomberg/Apple-grade bottom bar and bury the
cross-cutting jobs (watch a ticker, track a setup, run the market).

| # | Tab | SF Symbol (suggested) | Job (one line) | Contains |
|---|---|---|---|---|
| 1 | **Command** | `chart.bar.xaxis` / `command` | The market command center — "what is the whole market doing right now?" | Index tape, regime, premarket + flow briefs, news, earnings, session clock, global search |
| 2 | **Intelligence** | `square.grid.2x2` | The six desks — the deep tools | SPX Slayer · HELIX · Thermal · Largo · Night Hawk · Vector |
| 3 | **Signals** | `dot.radiowaves.left.and.right` | The setup lifecycle — "what should I be watching / did it work?" | Live setup inbox → detail (detected→confirming→active→managing→closed→invalidated→graded), track record, journal, coaching |
| 4 | **Watchlist** | `star` | The user's tickers, levels, and alerts | Watchlist, ticker detail, alert rules, levels, notification history |
| 5 | **Account** | `person.crop.circle` | Identity, membership, settings, learn, support | Profile, security (Face ID), membership, notifications, personal alerts, learn hub, FAQ, privacy, legal |

Design note: **Intelligence is a hub, not a single screen** — it lands on a desk grid and pushes
into each desk. This is the native answer to "six desks won't fit as six tabs."

---

## 2. TAB 1 — COMMAND (market command center)

**Job:** the at-a-glance macro read the six desks assume you already have. Today this data is
scattered across desk headers and cron-fed snapshots; **no single web page aggregates it**, so the
Command tab is largely **proposed** (net-new native), assembled from **existing APIs**.

| Screen | Job | Key elements | Data source (real) | Status |
|---|---|---|---|---|
| **Command Home** | One-glance market state on launch | Index tape, regime banner, "top of desk" cards (best live SPX play read + freshest Night Hawk edition + hottest flow), pull-to-refresh | Composed from the routes below | **proposed** (aggregator screen; data exists) |
| **Index tape** | Live SPX / VIX (+ NDX/RUT) spot | Ticker chips, live spot, day change, freshness stamp | `GET /api/market/indices` (SPX+VIX, WS `indexStore` w/ Polygon fallback); `GET /api/market/quote?ticker=` for per-name spot | **partial** (data live; surfaces inside desk headers, no standalone screen) |
| **Market regime** | The current regime label + bias | Regime word (risk-on/off, gamma sign), flip context | `GET /api/market/regime` (public snapshot, cron `market-regime-detector`) | **exists-web-only** (rendered as a banner inside desks) |
| **Premarket brief** | Pre-open SPX levels & bias | kingStrike, netGex, gexBias, key levels | `GET /api/brief/premarket` (premium; `isPremarketBriefFresh`) | **exists-web-only** |
| **Flow brief** | AI 15-min market-flow narrative | Short generated paragraph, refreshed per 15m window | `GET /api/market/flow-brief` (one shared Claude brief per window) | **exists-web-only** |
| **News** | Catalyst tape | Headlines by channel (fda/guidance/m&a/earnings), ticker filter | `GET /api/market/news` (Benzinga via Polygon key — see CLAUDE.md) | **exists-web-only** |
| **Earnings calendar** | Upcoming earnings dates | Ticker, report date, estimate | `GET /api/market/earnings-calendar` | **exists-web-only** |
| **Dark-pool context** | Market-wide dark-pool prints | Level tape, per-ticker drill | `GET /api/market/dark-pool`, `GET /api/market/dark-pool/ticker` | **exists-web-only** |
| **Global search** | Jump to any ticker/desk | Search field → ticker results → Watchlist/Vector | `GET /api/market/ticker-search?q=` (free tier; Polygon search) | **partial** (used inside Vector's ticker select) |
| **Session clock** | Pre / RTH / power-hour / after-hours state | ET session state, countdown to open/close | Client-derived from ET session helpers (`src/features/nighthawk/lib/session.ts`, `src/lib/providers/spx-session.ts`); no dedicated route | **proposed** |

---

## 3. TAB 2 — INTELLIGENCE (the six desks)

**Job:** the deep tools. Lands on a **desk grid** (six product marks + taglines from
`IOS_TOOLS`), each cell shows a live one-line status, tapping pushes the desk. Desk names, accents,
and marks are already canonical in `src/lib/ios-tool-routes.ts`.

### 3.0 Desk grid (hub)
- **Job:** choose a desk; see which are live vs launch-gated.
- **Key elements:** six cards (SPX Slayer, HELIX, Thermal, Largo, Night Hawk, Vector), each with
  `ProductMark`, tagline, accent, and a live micro-status; `ComingSoon` state for gated tools.
- **Data:** per-tool access via `canAccessTool` / `requireToolApi`; metadata from `IOS_TOOLS`.
- **Status:** **proposed** (the grid is new; the hybrid uses a bottom tab bar + slide menu
  `src/components/ios/IosNativeMenu.tsx` instead).

### 3.1 SPX Slayer — `/dashboard`  (web: `src/features/spx/components/SpxDashboard.tsx`)
The flagship 0DTE structure desk. Web page: `src/app/(site)/dashboard/page.tsx`
(`requireTier("premium")`, embeds the Vector chart via shared `loadVectorSeedProps`). The hybrid
already ships an **iOS segmented layout** (`vector | matrix | intel` — `SpxDashboard.tsx:~97`), so
this desk is **partial** toward native.

| Sub-screen | Job | Key elements | Data source (real) | Status |
|---|---|---|---|---|
| Desk overview | Live SPX structure + play read | Sniper header, spot, freshness | `GET /api/market/spx/desk` (`loadSpxDesk`), `GET /api/market/spx/merged` | **partial** |
| Live pulse | Sub-second tape | Index/tide/dark-pool/net-flow ticks | `GET /api/market/spx/pulse` + **SSE** `/api/market/spx/pulse/stream` | **partial** |
| GEX matrix | Dealer gamma across strikes | Heatmap grid, king strike, call/put walls | `SpxGexMatrixHeatmap` ← desk payload / `GET /api/market/gex-positioning` | **partial** |
| Play read | Graded (A–F) 0DTE play | Action (SCANNING/…), direction, entry/target/stop, invalidation, confirmations | `GET /api/market/spx/play` (`getSpxPlayState`); `useSpxPlay` hook | **partial** |
| Pin forecast | EOD pin projection | `SpxPinForecast` panel | `GET /api/market/spx/pin` | **exists-web-only** |
| Power hour | Late-session structure shift | Power-hour panel | `GET /api/market/spx/power-hour` | **exists-web-only** |
| Commentary rail | Desk narration | `SpxCommentaryRail` | `GET /api/market/spx/commentary` | **partial** |
| Signals log | Recent SPX signal fires | Time, grade, type | `GET /api/market/spx/signals` (`fetchRecentSpxSignals`) | **exists-web-only** |
| Embedded chart | Price + walls (shared w/ Vector) | Vector chart, chart-only | `loadVectorSeedProps("SPX")` + Vector APIs (§3.6) | **partial** |
| Flow lane | SPX-scoped flow | Flow panel | `GET /api/market/spx/flow` | **exists-web-only** |

### 3.2 HELIX — `/flows`  (web: `src/features/helix/components/HelixPageShell.tsx`)
Institutional flow tape. Page `src/app/(site)/flows/page.tsx` (`requireTier("premium")`). Shell has
`useIosNativeShell()` → **partial**.

| Sub-screen | Job | Key elements | Data source (real) | Status |
|---|---|---|---|---|
| Flow tape | Real-time UOA tape | `FlowFeed` — sweep/block, premium, ticker, anomaly score | **SSE** `/api/market/flows/stream` (GEX-enriched); `GET /api/market/flows` | **partial** |
| Anomaly banner | Surface outliers | `FlowAnomalyBanner` | `GET /api/market/anomalies` (premium) | **partial** |
| Tide bar | Net-flow tide | `HelixTideBar` | tide/net-flow from pulse stores | **partial** |
| Flow detail | Drill one print | Contract, side, size, GEX context | flow row payload (`enrichFlowWithGex`) | **proposed** (native detail sheet) |

### 3.3 BlackOut Thermal — `/heatmap`  (web: `src/features/thermal/components/ThermalPageShell.tsx`)
Dealer gamma/vanna map. Page `src/app/(site)/heatmap/page.tsx` (`requireTier("premium")` +
`canAccessTool("heatmap")` → `ComingSoon`). **partial**.

| Sub-screen | Job | Key elements | Data source (real) | Status |
|---|---|---|---|---|
| Gamma heatmap | GEX/VEX/DEX/CHARM across strikes×expiries | `Heatmap` grid, ticker switch, header spot | `GET /api/market/gex-heatmap`, `GET /api/market/heatmap`, `GET /api/market/quote` (header) | **partial** |
| Explain | Plain-English cell read | "Why this cell" text | `GET /api/market/gex-heatmap/explain` | **exists-web-only** |
| Matrix deltas | What changed since last snapshot | Delta overlay | `GET /api/market/gex-matrix-deltas` | **exists-web-only** |
| Positioning read | Canonical GEX/VEX positioning | Net GEX, flip, walls per ticker | `GET /api/market/gex-positioning?ticker=` | **exists-web-only** |

### 3.4 Largo — `/terminal`  (web: `src/features/largo/components/LargoPageShell.tsx`)
AI desk analyst. Page `src/app/(site)/terminal/page.tsx` (`requireTier("premium")` +
`canAccessTool("largo")`). Ships a dedicated `LargoNativeTerminal` for the iOS shell → **partial**.

| Sub-screen | Job | Key elements | Data source (real) | Status |
|---|---|---|---|---|
| Terminal | Ask the desk in plain English | Streaming answer, prompt bar, `LargoNativeTerminal` | **SSE** `POST /api/market/largo/query` (concurrency + AI-spend gated) | **partial** |
| Session history | Prior Q&A this session | Message list | `GET /api/market/largo/session` | **exists-web-only** |
| Suggested prompts | Cold-start guidance | Prompt chips grounded in live desks | client-seeded | **proposed** (native chip row) |

### 3.5 Night Hawk — `/nighthawk`  (web: `src/features/nighthawk/components/NighthawkPageShell.tsx`)
Evening swing playbook **plus** the 0DTE Command board (0DTE now rides the Night Hawk launch gate —
`src/app/api/market/zerodte/board/route.ts`). Page `src/app/(site)/nighthawk/page.tsx`
(`requireTier("premium")` + `canAccessTool("nighthawk")`). **partial**.

| Sub-screen | Job | Key elements | Data source (real) | Status |
|---|---|---|---|---|
| Playbook feed | Tomorrow's ranked setups | `NightHawkFeed`, tiered A–F cards, radar backdrop | `GET /api/market/nighthawk/edition` (`fetchLatestPlayableNighthawkEdition`) | **partial** |
| Play detail | Full thesis for one setup | Entry/target/stop, thesis, `play-explain` | `GET /api/market/nighthawk/play-explain` | **exists-web-only** |
| Morning confirm | Overnight status of each play | Per-play CONFIRMED / DEGRADED / INVALIDATED | `GET /api/nighthawk/play-status` (cron `nighthawk-morning-confirm` 9:15 ET) | **exists-web-only** |
| Record | Graded A–F swing ledger | Win rate, per-play outcomes | `GET /api/market/nighthawk/record` (`nighthawk_play_outcomes`) | **exists-web-only** |
| 0DTE Command board | Live single-name 0DTE hunt | Fresh finds + graded session ledger | `GET /api/market/zerodte/board`; live marks **SSE** `/api/market/zerodte/marks/stream` (+ REST `/marks`) | **partial** |
| Lotto | Today's lotto candidates | Lotto list | `GET /api/market/lotto/today` | **exists-web-only** |
| Hunt (scanner) | Trigger a fresh scan | Scan trigger + results | `GET /api/market/nighthawk/hunt` | **exists-web-only** |

### 3.6 Vector — `/vector`  (web: `src/features/vector/components/VectorPageShell.tsx`)
Gamma-wall radar. Page `src/app/(site)/vector/page.tsx` (`requireTier("premium")` +
`canAccessTool("vector")`). Non-tab today but has full native chrome; the richest mobile surface —
**partial**, and the reference for native chart work.

| Sub-screen | Job | Key elements | Data source (real) | Status |
|---|---|---|---|---|
| Chart | Price + GEX/VEX wall beads, flip line | `VectorChart`, TF toggle (1m/5m/15m/1H), DTE toggle (0DTE/weekly/monthly/all), indicator menu, dark-pool overlays | **SSE** `/api/market/vector/stream`; `GET /api/market/vector/bars`; `loadVectorSeedProps` | **partial** |
| GEX ladder | Ranked walls per side | `VectorGexLadder`, king strike, magnitudes | `GET /api/market/vector/gex-ladder`, `/walls` (horizon-scoped) | **partial** |
| Wall history | How walls formed/grew/faded | `wall-history` bead trail | `GET /api/market/vector/wall-history` | **partial** |
| Regime banner | Spot-vs-flip regime | `VectorRegimeBanner` (`deriveVectorRegime`) | derived from walls/flip payload | **partial** |
| Max pain / expected move | Pin + expected range | Max-pain strike, EM band | `GET /api/market/vector/max-pain`, `/expected-move` | **exists-web-only** |
| Prior-day levels | Prior OHLC overlays | Prior high/low/close lines | `GET /api/market/vector/prior-day` | **exists-web-only** |
| Flow lane | Per-ticker flow | Vector-scoped flow | `GET /api/market/vector/flow` | **exists-web-only** |
| Scanner / universe | Cross-ticker radar | `VectorScanner`, universe grid | `GET /api/market/vector/universe` | **partial** |
| Ticker select | Switch instrument | `VectorTickerSelect` | `GET /api/market/ticker-search` | **partial** |
| Alerts panel | Wall/flip alerts (per-ticker) | `VectorAlertsPanel` — see §5 (moves to Watchlist natively) | client store `vector-alerts-store` (localStorage); notify via `enableVectorNotifications` | **partial** |

---

## 4. TAB 3 — SIGNALS (setup lifecycle)

**Job:** the single place a member tracks a setup from birth to grade —
**detected → confirming → active → managing → closed → invalidated → graded**. This is the biggest
**net-new native surface**: today the lifecycle is *modeled server-side* but **scattered** across
desk panels; no unified inbox exists.

**Ground truth on the lifecycle (do not invent a new state machine):** the canonical FSM is
`PlaybookLifecycleState` in `src/features/spx/lib/playbook-trade-fsm.ts`:

```
idle → armed → triggered ┐              ┌→ closed
                          ├→ entry_pending → open → managing → exit_pending →┤→ invalidated
              (blocked) ──┘                                                  └→ expired / cancelled
```

Map the master-prompt lifecycle words onto these real states:

| IA stage (master prompt) | Real FSM state(s) | Where it's produced |
|---|---|---|
| **detected** | `armed` (precondition match), pre-`triggered` | `deriveState`/FSM in `playbook-trade-fsm.ts`; SPX `getSpxPlayState` action `SCANNING`→armed |
| **confirming** | `triggered`, `entry_pending` (also `blocked`) | `playbook-fsm-sync.ts` transitions; SPX play `confirmations` |
| **active** | `open` | `playbook-fsm-sync.ts` `→ open` engine |
| **managing** | `managing`, `exit_pending` | `playbook-fsm-sync.ts` `→ managing` / `→ exit_pending` |
| **closed** | `closed` | terminal; `isTerminalPlaybookState` |
| **invalidated** | `invalidated` (also `expired`/`cancelled`) | terminal; counterfactual `setup_invalidated` |
| **graded** | outcome row written | **real ledgers**: `spx_play_outcomes`, `nighthawk_play_outcomes` (via `src/lib/signal-accuracy.ts`) |

**Critical grounding note (avoid a trap):** the routes `/api/signals/{open,outcome,record}` and the
`signal_events` / `signal_outcomes` tables are **ORPHANED** — cron-gated (`isCronAuthorized`), never
written in production (see the header comments in `src/app/api/signals/record/route.ts` and
`docs/audit/FINDINGS.md`). **Do not build the native Signals tab on those routes.** The live
lifecycle data comes from: SPX play state (`/api/market/spx/play`), the FSM sync surface
(`/api/admin/playbook/fsm-today`, admin-only today), Night Hawk edition + morning-confirm, the 0DTE
board, and the **graded ledgers** exposed by `/api/market/spx/outcomes` and
`/api/market/nighthawk/record`. A **member-facing lifecycle feed API is `missing`** and must be
built to power this tab (proposed: a `/api/signals/live` that reads the real ledgers + play/edition
state, tier-gated — not the orphaned cron routes).

| Screen | Job | Key elements | Data source (real) | Status |
|---|---|---|---|---|
| **Signals inbox** | All live setups, grouped by stage | Cards grouped detected/confirming/active/managing; grade chip, ticker, desk badge, age | Composed: `/api/market/spx/play`, Night Hawk `/edition` + `/play-status`, `/api/market/zerodte/board` | **proposed** (needs a member lifecycle API — **missing** today) |
| **Setup detail** | One setup, full lifecycle timeline | Stage timeline (the 7 stages), entry/target/stop, invalidation level, confirmations, live P/L context, counterfactual for triggered-not-opened | `getSpxPlayState`; FSM (`playbook-trade-fsm.ts`); counterfactual (`playbook-counterfactual-contract.ts`) | **proposed** |
| **Graded ledger (track record)** | Did the reads work? | A–F outcomes, win rate, by-source accuracy, append-only | `GET /api/market/spx/outcomes`, `GET /api/market/nighthawk/record`, `GET /api/market/zerodte/record`; `src/lib/signal-accuracy.ts`; `/api/platform/intel` (blended accuracy) | **exists-web-only** (data); native ledger screen **proposed** |
| **Journal** | Member's own notes per play | Per-`open_play_id` notes, edit | `GET/POST /api/market/spx/journal` (per-user) | **exists-web-only** |
| **Coaching alerts** | Contextual desk coaching | Trigger type, alert text, urgency | `GET /api/coaching/alerts` (premium; cron writes) | **exists-web-only** |
| **Accuracy / platform intel** | Blended track-record stats | Win rate by source, sample sizes, recommendation gate | `GET /api/platform/intel` (`blendedAccuracy`, `MIN_SAMPLE_FOR_RECOMMENDATION`) | **exists-web-only** |
| **Admin FSM (internal)** | Operator lifecycle audit | FSM-today transitions, promotion report | `GET /api/admin/playbook/fsm-today`, `/promotion-report` (admin only) | **exists-web-only** (not member-facing; excluded from consumer IA) |

> Legacy public `/track-record` page now **redirects to `/admin?tab=track-record`**
> (`src/app/(site)/track-record/page.tsx`), and `/api/track-record/plays` +
> `/api/public/track-record` are **admin-only**. So the *member* graded view in this tab must be
> built on the desk outcome routes above, not the admin track-record endpoints.

---

## 5. TAB 4 — WATCHLIST (tickers / alerts / levels)

**Job:** the member's own tickers, the price/structure levels they care about, and the alert rules
that watch them. Today a **partial** version of this exists **only inside Vector**
(`VectorAlertsPanel` + `src/features/vector/lib/vector-alerts.ts`, alerts persisted to
**localStorage** via `vector-alerts-store`). A native, cross-desk Watchlist is **proposed**, with a
real server-persisted alert store as the key **missing** piece.

**Alert model that exists today (build on it):** `AlertKind = "wall-touch" | "flip-cross"`
(`vector-alerts.ts`); rules carry a tolerance band; firing is evaluated client-side against the
Vector stream with a `ALERT_COOLDOWN_MS` (60s) cooldown; notification presentation via
`enableVectorNotifications` / `presentSystemNotification` (`vector-notify-client.ts`). **This is
web-notification-based and does not fire when the app is backgrounded** — the native tab must move
this to **APNs** (see §7, N-2 in `IOS-PREMIUM-PROGRAM.md`).

| Screen | Job | Key elements | Data source (real) | Status |
|---|---|---|---|---|
| **Watchlist** | The member's tracked tickers | Rows: ticker, spot, day change, regime dot, nearest wall; reorder/remove | Spot via `GET /api/market/quote?ticker=`; regime via `gex-positioning`; **watchlist persistence route is missing** | **proposed** (list is new; per-row data exists) |
| **Add ticker** | Search + add to watchlist | Search field, results, allow-list check | `GET /api/market/ticker-search?q=`; `isVectorTickerAllowed` (`vector-ticker.ts`) | **partial** |
| **Ticker detail** | Everything on one name | Mini chart, GEX ladder, walls, flip, max-pain, EM, dark-pool, flow, news | Vector suite (§3.6) scoped to ticker + `gex-positioning` + `dark-pool/ticker` + `news` | **proposed** (aggregates existing APIs) |
| **Levels** | Key structural levels per ticker | Call/put walls, flip, king strike, prior-day OHLC, max-pain | `/api/market/vector/walls`, `/prior-day`, `/max-pain`; `/api/market/gex-positioning` | **partial** |
| **Alert rules** | Create/manage alerts | List of rules (wall-touch / flip-cross), per-ticker, tolerance, on/off | `vector-alerts.ts` model; store today = **localStorage** (`vector-alerts-store`) → **needs server route (missing)** | **partial** |
| **Alert detail / create** | Configure one rule | Kind picker, ticker, band, delivery channel | `buildAlertRule` (`vector-alerts.ts`); delivery → APNs (proposed) | **partial** |
| **Notification history** | What fired, when | `FiredAlert` feed, tap → ticker/desk (deep link) | `FiredAlert` (`vector-alerts.ts`); deep-link routing **missing** (`@capacitor/app` unused) | **proposed** |

---

## 6. TAB 5 — ACCOUNT (identity / membership / settings / learn / support)

**Job:** everything not a tool — identity, membership status (read-only, **no purchase UI** per
3.1.1), notification + security settings, and the education/support content. Page today:
`src/app/(site)/account/page.tsx` (`AccountProfilePanel` + `PersonalAlertsSettings`). **partial**.

| Screen | Job | Key elements | Data source (real) | Status |
|---|---|---|---|---|
| **Profile** | View/manage account | Email, phone, name; Clerk `<UserProfile>` | Clerk (`@clerk/nextjs`); `AccountProfilePanel`; `GET /api/auth/me` | **partial** |
| **Membership** | Show tier (read-only) | Current tier, "managed on the web" note, **Sync membership** | `GET`/`POST /api/membership/sync` (Whop); tier from `publicMetadata.tier` | **partial** (3.1.1: no price/checkout — see COMPLIANCE audit) |
| **Security / Face ID** | Biometric app-lock toggle | Face ID on/resume gate | **missing** — no biometric plugin wired (audit §A); config comment advertises it, not implemented | **missing** |
| **Notifications** | Push + alert delivery prefs | Master push toggle, per-desk alert prefs | `POST /api/push/subscribe`, `/api/push/send` (web-push; **inert in WKWebView**, APNs **missing**) | **partial** (web-push exists; APNs missing) |
| **Personal play alerts** | Personal Discord webhook | Set/clear webhook, redacted host display | `GET/PUT/DELETE /api/account/personal-alerts` (premium; Clerk privateMetadata) | **partial** |
| **Connected devices** | Sessions / devices | Device list, sign-out | Clerk session mgmt | **exists-web-only** |
| **Learn hub** | Education | Index + per-desk guides | `src/app/(marketing)/learn/*` — `/learn`, `getting-started`, `glossary`, `heat-maps`, `helix-flows`, `largo-ai`, `night-hawk`, `spx-slayer` (8 routes) | **exists-web-only** |
| **FAQ / Support** | Help + contact | Q&A, `support@blackouttrades.com` | `src/app/(marketing)/faq/page.tsx` (`src/lib/faq/content.ts`) | **exists-web-only** |
| **Privacy Policy** | Apple-required policy URL | Data-collection disclosure | **`/privacy` route does NOT exist** (P0-1 blocker; see ASC-METADATA + EXECUTION-STATE) | **missing** |
| **Legal / disclaimers** | Not-a-broker / educational-only | Disclaimer copy | `src/components/OnboardingGuide.tsx:154`, `UpgradePageShell.tsx:94`, `faq/content.ts:66` | **exists-web-only** |
| **About / version** | Build + version | App version, links | native `Bundle` info | **proposed** |
| **Sign out** | End session | Sign-out action | Clerk `signOut` | **partial** |

---

## 7. Cross-cutting native surfaces (shell-level, not a tab)

These appear across tabs and are where "native, not WebView" is won. Wiring truth from
`docs/ios/NATIVE-VALUE-AND-PRIVACY-AUDIT.md`:

| Surface | Job | Reality today | Status |
|---|---|---|---|
| **Onboarding / first-run** | Sign-in-only entry (no pricing) | `OnboardingGuide.tsx`; marketing `/` gated for iOS (P0-2) | **partial** |
| **Sign in / Sign up** | Email OTP (+ password for demo) | `/sign-in`, `/sign-up` (Clerk); social hidden in-app | **exists-web-only** |
| **Offline / reconnect** | Graceful no-network state | `src/app/offline/page.tsx`; WKWebView reconnect splash | **partial** |
| **Haptics** | Tactile feedback | `src/lib/ios-haptics.ts` — the one fully-wired native bridge | **exists-native** |
| **Push (APNs)** | Real alert delivery | **Not wired** — web-push only, inert in WKWebView; APNs token/register/table/sender all **missing** (N-2) | **missing** |
| **Face ID app-lock** | Resume gate | **Not wired** (N-1) | **missing** |
| **Deep links** | Alert → correct desk/setup | `@capacitor/app` `appUrlOpen` present but **unused** | **missing** |
| **Native share** | Share a chart/play | `@capacitor/share` absent | **missing** |
| **Status bar / splash** | Chrome polish | Config-only; `StatusBar.*` never called (partial) | **partial** |
| **Global search** | Command-K across app | ticker-search API exists; native surface new | **proposed** |

---

## 8. Full screen inventory — master-prompt ~48 screens → this IA

Consolidated map (desk sub-screens counted individually). Status uses §0. "Route/API" is the
primary real backing; see the per-tab tables for the full set.

| # | Screen | Tab | Primary route / API | Status |
|---|---|---|---|---|
| 1 | Command Home | Command | (aggregator) | proposed |
| 2 | Index tape | Command | `/api/market/indices`, `/api/market/quote` | partial |
| 3 | Market regime | Command | `/api/market/regime` | exists-web-only |
| 4 | Premarket brief | Command | `/api/brief/premarket` | exists-web-only |
| 5 | Flow brief (AI) | Command | `/api/market/flow-brief` | exists-web-only |
| 6 | News | Command | `/api/market/news` | exists-web-only |
| 7 | Earnings calendar | Command | `/api/market/earnings-calendar` | exists-web-only |
| 8 | Dark-pool context | Command | `/api/market/dark-pool` | exists-web-only |
| 9 | Global search | Command | `/api/market/ticker-search` | partial |
| 10 | Session clock | Command | (client, ET session libs) | proposed |
| 11 | Desk grid (hub) | Intelligence | `IOS_TOOLS` + `canAccessTool` | proposed |
| 12 | SPX desk overview | Intelligence | `/api/market/spx/desk`, `/merged` | partial |
| 13 | SPX live pulse | Intelligence | SSE `/api/market/spx/pulse/stream` | partial |
| 14 | SPX GEX matrix | Intelligence | `/api/market/gex-positioning` | partial |
| 15 | SPX play read | Intelligence | `/api/market/spx/play` | partial |
| 16 | SPX pin forecast | Intelligence | `/api/market/spx/pin` | exists-web-only |
| 17 | SPX power hour | Intelligence | `/api/market/spx/power-hour` | exists-web-only |
| 18 | SPX commentary | Intelligence | `/api/market/spx/commentary` | partial |
| 19 | SPX signals log | Intelligence | `/api/market/spx/signals` | exists-web-only |
| 20 | HELIX flow tape | Intelligence | SSE `/api/market/flows/stream` | partial |
| 21 | HELIX anomaly banner | Intelligence | `/api/market/anomalies` | partial |
| 22 | HELIX tide bar | Intelligence | pulse tide store | partial |
| 23 | HELIX flow detail | Intelligence | flow row payload | proposed |
| 24 | Thermal gamma heatmap | Intelligence | `/api/market/gex-heatmap`, `/heatmap` | partial |
| 25 | Thermal explain | Intelligence | `/api/market/gex-heatmap/explain` | exists-web-only |
| 26 | Thermal matrix deltas | Intelligence | `/api/market/gex-matrix-deltas` | exists-web-only |
| 27 | Largo terminal | Intelligence | SSE `/api/market/largo/query` | partial |
| 28 | Largo session history | Intelligence | `/api/market/largo/session` | exists-web-only |
| 29 | Night Hawk playbook feed | Intelligence | `/api/market/nighthawk/edition` | partial |
| 30 | Night Hawk play detail | Intelligence | `/api/market/nighthawk/play-explain` | exists-web-only |
| 31 | Night Hawk morning confirm | Intelligence/Signals | `/api/nighthawk/play-status` | exists-web-only |
| 32 | Night Hawk record | Intelligence/Signals | `/api/market/nighthawk/record` | exists-web-only |
| 33 | 0DTE Command board | Intelligence | `/api/market/zerodte/board` (+ SSE marks) | partial |
| 34 | Lotto | Intelligence | `/api/market/lotto/today` | exists-web-only |
| 35 | Vector chart | Intelligence | SSE `/api/market/vector/stream`, `/bars` | partial |
| 36 | Vector GEX ladder | Intelligence | `/api/market/vector/gex-ladder`, `/walls` | partial |
| 37 | Vector wall history | Intelligence | `/api/market/vector/wall-history` | partial |
| 38 | Vector max-pain / EM | Intelligence | `/api/market/vector/max-pain`, `/expected-move` | exists-web-only |
| 39 | Vector scanner / universe | Intelligence | `/api/market/vector/universe` | partial |
| 40 | Signals inbox | Signals | (member lifecycle API — missing) | proposed |
| 41 | Setup detail (7-stage) | Signals | `spx/play` + FSM + counterfactual | proposed |
| 42 | Graded ledger | Signals | `/api/market/spx/outcomes`, `/nighthawk/record` | exists-web-only |
| 43 | Journal | Signals | `/api/market/spx/journal` | exists-web-only |
| 44 | Coaching alerts | Signals | `/api/coaching/alerts` | exists-web-only |
| 45 | Accuracy / platform intel | Signals | `/api/platform/intel` | exists-web-only |
| 46 | Watchlist | Watchlist | `/api/market/quote` (+ persistence missing) | proposed |
| 47 | Ticker detail | Watchlist | Vector suite + `gex-positioning` + `news` | proposed |
| 48 | Levels | Watchlist | `/api/market/vector/walls`, `/prior-day` | partial |
| 49 | Alert rules / detail | Watchlist | `vector-alerts.ts` (+ server store missing) | partial |
| 50 | Notification history | Watchlist | `FiredAlert` (+ deep link missing) | proposed |
| 51 | Account profile | Account | Clerk / `/api/auth/me` | partial |
| 52 | Membership (read-only) | Account | `/api/membership/sync` | partial |
| 53 | Security / Face ID | Account | (biometric — missing) | missing |
| 54 | Notifications settings | Account | `/api/push/subscribe` (APNs missing) | partial |
| 55 | Personal play alerts | Account | `/api/account/personal-alerts` | partial |
| 56 | Learn hub (8 pages) | Account | `(marketing)/learn/*` | exists-web-only |
| 57 | FAQ / Support | Account | `(marketing)/faq` | exists-web-only |
| 58 | Privacy Policy | Account | `/privacy` (route does not exist) | missing |
| 59 | Legal / disclaimers | Account | `OnboardingGuide`/`faq` copy | exists-web-only |
| 60 | Onboarding / first-run | Shell | `OnboardingGuide.tsx` | partial |
| 61 | Sign in / Sign up | Shell | `/sign-in`, `/sign-up` (Clerk) | exists-web-only |
| 62 | Offline / reconnect | Shell | `/offline` | partial |

> The master prompt's "~48 screens" expands to **62 discrete screens** once each desk's
> sub-screens and the shell surfaces are enumerated. The count is higher because six deep desks
> each carry 3–10 real sub-surfaces; the 48 figure treats desks more coarsely. Admin/dev routes
> (`/admin/**`, `/dev/**`, `/api/admin/**`) are **intentionally excluded** from the consumer IA —
> they are operator tooling, not member screens (Apple demo account must **not** be `role:admin`
> for that reason, per ASC-METADATA).

---

## 9. What is genuinely missing to build this IA (the gap list)

Ordered by how much of the IA they unblock:

1. **Member lifecycle API (`missing`)** — the Signals inbox/detail need a tier-gated read that
   unifies live play state + FSM stage + graded outcomes. **Do not** reuse the orphaned
   `/api/signals/*` cron routes (`signal_events`/`signal_outcomes` never written in prod). Compose
   from `spx/play`, Night Hawk edition/confirm, zerodte board, and the outcome ledgers.
2. **Server-persisted watchlist + alert store (`missing`)** — alerts today live in localStorage
   (`vector-alerts-store`) and only fire client-side while Vector is open. Native needs a
   user-keyed store (parallel to `push_subscriptions`) so alerts survive and fire in background.
3. **APNs push (`missing`, N-2)** — the delivery mechanism for Watchlist alerts + Signals stage
   changes. Web-push is inert in the WKWebView; a real native token → table → server APNs sender is
   required. Hide the inert web-push toggle in-app.
4. **Deep-link routing (`missing`)** — `@capacitor/app` `appUrlOpen` is unused; without it a pushed
   alert can't open the right setup/desk (Signals + Notification-history + Command all depend on it).
5. **Face ID app-lock (`missing`, N-1)** — the Account security screen; advertised in config, not
   implemented.
6. **`/privacy` page (`missing`, P0-1)** — Apple hard blocker; also the Account → Privacy screen.
7. **Command aggregator + Session clock (`proposed`)** — no route needed beyond the existing market
   APIs; purely a new composed screen + client ET-session logic.

Everything else in the IA is **data that already exists** behind real, tier-gated routes under
`src/app/api/market/**` and `src/app/api/**`; the native work is presentation + the six gaps above.
