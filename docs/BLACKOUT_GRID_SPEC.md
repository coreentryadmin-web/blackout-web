# BlackOut Grid — Page Spec

Status: SPEC (docs-only). Branch `auto/api-grid-plan` off `origin/main` (b421330).
Date: 2026-06-26. Buildable directly from this document.

The **BlackOut Grid** is a single market-intelligence dashboard at `/grid`: a 12-tile
masonry of live market-wide panels (news, flow, earnings, analysts, movers, dark pool,
smart money, econ calendar, sector heat, positioning, catalysts) anchored by a Market Pulse
hero strip. It surfaces datasets the platform already pays for but only consumes per-ticker
or not at all, and it does so **without spending the UW 2-RPS budget** by reading Redis
snapshots written by one cluster-wide writer (the cache-reader rule).

## 0. Architecture & non-negotiables

- **Cache-reader, always.** Every `/api/grid/*` route reads Redis snapshots written by a
  cron/WS writer. No route fetches UW REST per request. One warmer serves N viewers at a
  fixed cost. Live lanes (news/flow/tide) come from the existing/extended SSE, not polling.
- **Server shell + client board.** `page.tsx` is a Server Component (auth + gate + metadata);
  `GridBoard.tsx` is `"use client"` and owns layout, polling, SSE, drag-order.
- **Reuse, don't reinvent.** Mirror `flows/page.tsx` (`PageShell` + `PageHeader` +
  `ProductMark`). Reuse `FlowFeed` (compact) for the Flow panel; reuse the unmounted
  `SpxDarkPoolCard` (#97) for Dark Pool; reuse `parseUwEconomicCalendar` /
  `mergeMacroEventsToday` for the Econ panel.
- **Brand (Living Terminal).** emerald=bullish, `#ff5c78`/`#ff2d55`=bear, sky=neutral/info,
  gold=highlight/king. **No grey** (`text-grey/zinc/neutral` banned on `#040407` — use
  `text-cyan-400`/`text-sky-300`/`text-white`). Ambient VITALS pulse on live tiles; respect
  `prefers-reduced-motion`.

## 1. Routing, gating, nav

- **Route:** `src/app/(site)/grid/page.tsx` — Server Component, `await requireTier("premium")`,
  `PageShell` + `PageHeader(kicker, title="GRID", subtitle, badge=<ProductMark product="grid">)`.
- **Gating:** add `ToolKey "grid"` to `src/lib/tool-access.ts` `TOOLS`
  (`{ key:"grid", label:"BlackOut Grid", href:"/grid", product:"grid", defaultLaunched:false }`).
  Padlock until ready; flip live via `LAUNCHED_TOOLS=grid` (additive env, no redeploy). Admin
  bypass is automatic via `tool-access-server.ts`. Each `/api/grid/*` route calls
  `requireToolApi("grid")` and returns the lock response for non-admins (parity with
  `gex-positioning/route.ts`).
- **ProductMark sigil:** add `"grid"` to `MarkProduct` + `MARK_ACCENT` (suggest gold
  `#ffcc4d` or a distinct cyan-white) + `DEFAULT_TITLE`/`NAV_TO_MARK` in
  `src/components/marks/ProductMark.tsx`. Add a new `grid` sigil glyph (4-square / masonry
  motif).
- **Nav:** add `FEATURE_LINKS` entry in `src/components/Nav.tsx` → `/grid`, gated by the
  same key so it shows the padlock when locked.

## 2. Data plane

- **New cron `grid-warm`** (or extend `uw-cache-refresh`): every 30-60s during RTH (and a
  slow cadence after-hours) it calls the market-wide UW/Benzinga fetchers ONCE and writes
  per-panel snapshots to Redis under `grid:*` keys via `uwCacheSet`. Register a
  `railway.grid-warm.toml` + add to `scripts/hit-cron.mjs` (Bearer `CRON_SECRET`).
  **CRITICAL:** market-hours cron services died mid-RTH before (#90) — give `grid-warm` the
  same RTH-resilience and watchdog the other warmers got.
- **`/api/grid/*` route handlers** (one per panel, `runtime="nodejs"`, `dynamic="force-dynamic"`,
  `authorizeMarketDeskApi` + `requireToolApi("grid")`): read the `grid:*` snapshot from Redis
  and return it. Return `{ available:false }` (200) on cache miss — never fabricate, never
  throw to client.
- **Live lanes via SSE:** extend the pulse SSE (#95) to carry `tideStore` + the new
  `newsStore` (WS `news`) + `netFlowStore` (WS `net_flow`). News/Flow/Pulse/Dark-Pool panels
  subscribe; everything else polls its `/api/grid/*` at the cadence below. Show a `LIVE`
  badge when the SSE/WS is connected, fall back to poll otherwise.

Required new/changed providers (see `docs/API_UTILIZATION_FULL_PLAN.md`):
`fetchBenzingaChannelFeed(channels,limit)` (market-wide), `fetchUwFdaCalendarMarket(limit)`,
the WS `news`/`net_flow`/`gex` subscriptions + stores, and the **path-bug fixes**
(`fetchUwEtfInOutflow`, `fetchUwEtfTide`) which the Sector/ETF and Positioning lanes depend on.

## 3. Layout

- **Grid:** CSS-grid masonry. Desktop 4-col / tablet 2-col / mobile 1-col. Pulse is a
  full-width top strip (spans all columns). The other 12 tiles flow as `GridCard`s.
- **Drag order:** tiles draggable; order persisted to `localStorage` (`grid:order:v1`).
  Default order = priority order below.
- **`GridCard` shared shell:** title row (icon + label + `ProductMark`-style accent bar +
  live dot), body, optional footer/filter row. One component, themed per-panel by accent.
- **Empty/closed states:** intentional "market closed" / "no data" treatment per panel
  (reuse the desk empty-state system, #82) — never a blank or grey box.

## 4. Panels

Each panel: **sources → UX → refresh → filters → build steps.** Call sites are current
`origin/main` line refs.

### Panel 1 — Market Pulse (hero strip) · high
- **Sources:** `market_tide` WS (`uw-socket.ts:617`, RPS-free) + `fetchUwMarketTotalOptionsVolume` (`:1781`) + Polygon indices snapshot (SPX/VIX, already on the indices socket).
- **UX:** full-width strip — net-premium tide sparkline, market P/C ratio gauge, SPX/VIX/breadth chips. Live via pulse SSE.
- **Refresh:** push (WS) for tide; gauge from cached total-options-volume.
- **Filters:** none (timeframe toggle optional).
- **Build:** `PulseStrip.tsx`; fold `tideStore` into pulse SSE (#95); gauge from cached total-options-volume.

### Panel 2 — Unified News Feed (multi-channel) · high
- **Sources:** Benzinga channels (top-stories/movers/m&a/fda/guidance/wiim via `channels.any_of`, `polygon.ts:389`) + UW headlines (`is_major`/`sentiment`, `unusual-whales.ts:1195`) + **UW news WS** for push.
- **UX:** tabbed channel chips; sentiment-colored rows (emerald/bear/sky); `is_major` pinned lane; infinite scroll; ticker-click → drill; `LIVE` badge when WS connected.
- **Refresh:** push (WS) with 30s poll fallback.
- **Filters:** channel chips, `is_major` toggle, ticker.
- **Build:** `NewsFeed.tsx` + `/api/grid/news` (cache-reader merging both providers, dedup by normalized headline). Wire UW `news` WS → `newsStore` → SSE. Add `fetchBenzingaChannelFeed`.

### Panel 3 — Notable / Unusual Flow · high
- **Sources:** HELIX flow SSE (existing) + `fetchMarketFlowAlerts` (`:556`) + `flow_alerts` WS (`uw-socket.ts:592`).
- **UX:** compact reuse of HELIX `FlowFeed`; whale-highlight rows; live.
- **Refresh:** live (existing flow stream).
- **Filters:** premium>X, has_sweep, opening, DTE, sector; whale preset.
- **Build:** mount `<FlowFeed compact>` pointed at the existing flow stream; add whale preset filter. **No new ingest.**

### Panel 4 — Earnings (Upcoming + Surprises) · high
- **Sources:** `fetchUwEarningsPremarket`/`Afterhours` (`:1803`/`:1808`) + `fetchUwEarnings` historical (`:1152`) + earnings-estimates (`:1335`) + Benzinga earnings channel.
- **UX:** two lanes — Upcoming grouped AM/PM with consensus EPS/rev + implied move; Recent Surprises beat/miss colored emerald/bear.
- **Refresh:** 5min.
- **Filters:** AM/PM, beat/miss.
- **Build:** `EarningsPanel.tsx` + `/api/grid/earnings`. Compute beat/miss from actual vs estimate; badge AM/PM.

### Panel 5 — Analyst Actions · high
- **Sources:** `fetchUwScreenerAnalysts` (`:1937`, structured action/target/firm) PRIMARY + Benzinga analyst-ratings channel (`polygon.ts:424`, **after the channel-name fix**) enrichment.
- **UX:** live ticker rows colored by action (upgrade emerald / downgrade bear / maintain sky); firm + old→new PT + %-to-target.
- **Refresh:** 2-5min.
- **Filters:** action type, sector.
- **Build:** `AnalystActions.tsx` + `/api/grid/analysts`.

### Panel 6 — After-Hours / Movers · high
- **Sources:** `fetchUwMarketMovers` (`:1203`, `data.most_active/gainers/losers`) + Polygon snapshot movers fallback.
- **UX:** 3-way toggle Active/Gainers/Losers; %-colored bars + volume; extended-hours AH movement.
- **Refresh:** 30-60s.
- **Filters:** the 3-way toggle.
- **Build:** `MoversPanel.tsx` + `/api/grid/movers`.

### Panel 7 — Dark-Pool Prints · high
- **Sources:** `fetchUwDarkPoolRecent` (`:1383`) + `off_lit_trades` WS (already subscribed, `uw-socket.ts:638`).
- **UX:** top prints by premium; ticker/size/price/% of NBBO; late-print badge. Reuse `SpxDarkPoolCard` look (#97 component exists, unmounted).
- **Refresh:** WS push or 30s.
- **Filters:** premium threshold, ticker.
- **Build:** `DarkPoolPanel.tsx` fed by the `off_lit_trades` store; surface the unmounted `SpxDarkPoolCard` work.

### Panel 8 — Smart Money (Congress + Insiders) · medium
- **Sources:** `fetchUwCongressTrades` (`:1116`) + `fetchUwCongressLateReports` (`:1284`) + `fetchUwInsiderTransactions` (`:1316`) + market insider-buy-sells. Benzinga insider channel as cross-check.
- **UX:** tabbed Congress | Insiders; buy emerald / sell bear; $ range, member/role, filing lag.
- **Refresh:** 15min (slow-moving).
- **Filters:** buy/sell, tab.
- **Build:** `SmartMoneyPanel.tsx` + `/api/grid/smart-money` (long TTL).

### Panel 9 — Economic Calendar · high
- **Sources:** `fetchUwMarketEconomicCalendar` (`:1790`) + `macro-events.ts` merge (live UW primary + curated FOMC/BLS fallback).
- **UX:** today + next-N, time-ordered, impact dots, prev/forecast/actual columns, countdown to next high-impact.
- **Refresh:** 5min.
- **Filters:** impact level, today/week.
- **Build:** `EconCalendar.tsx` reusing `parseUwEconomicCalendar` + `mergeMacroEventsToday`. Optional: join Massive `/fed` reads to show prevailing data point next to each print.

### Panel 10 — Sector Heat · high
- **Sources:** `fetchUwMarketSectorEtfs` (`:1932`, per-ETF call/put premium + `in_out_flow[]`) + `fetchUwSectorTide` (`:1100`).
- **UX:** 11 SPDR tiles (XLK/XLF/XLE…) heat grid colored by %chg, each with a call/put-premium skew bar + flow arrow; click → sector drill. **Best single breadth tile.**
- **Refresh:** 60s.
- **Filters:** sort by %chg / premium skew / flow.
- **Build:** `SectorHeat.tsx` + `/api/grid/sectors`.

### Panel 11 — Positioning (Net Impact + OI Change) · medium
- **Sources:** `fetchUwMarketTopNetImpact` (`:1211`) + `fetchUwMarketOiChange` (`:1219`). (After WS `net_flow` lands, fold in live net-flow.)
- **UX:** dual compact lists — Top Net Premium Impact leaderboard + Biggest OI Build/Unwind (new vs closing colored).
- **Refresh:** 5min.
- **Filters:** build/unwind toggle.
- **Build:** `PositioningPanel.tsx` + `/api/grid/positioning`.

### Panel 12 — FDA / Catalysts · medium
- **Sources:** `fetchUwFdaCalendarMarket(limit)` (**new market-wide wrapper**; current `fetchUwFdaCalendar` `:1324` is ticker-scoped) + Benzinga `fda` channel + (phase-2) IPO calendar `/api/calendar/ipo`.
- **UX:** upcoming FDA decision dates with drug/stage badges, biotech ticker chips.
- **Refresh:** 1h (long TTL).
- **Filters:** stage, date window.
- **Build:** `CatalystPanel.tsx` + `fetchUwFdaCalendarMarket` + `/api/grid/catalysts`.

## 5. Styling (Living Terminal)

- Brand tokens: emerald=bullish, `#ff5c78`/`#ff2d55`=bear, sky=neutral/info, gold=highlight/king. **No grey.**
- Primitives: `PageShell`, `PageHeader`, `ProductMark` (`components/marks`), `src/components/ui`.
- Each panel = a `GridCard` (shared shell: title row + ProductMark-style accent bar + live dot). Sentiment/action coloring via semantic tokens. Ambient VITALS pulse on live tiles (#81 Phases 0/1). Respect `prefers-reduced-motion`. New `grid` ProductMark sigil for nav/lock.

## 6. Implementation phases (priority order)

**Phase 0 — Scaffold.** `grid` ToolKey + ProductMark sigil + Nav link (locked). Server shell
`grid/page.tsx`. `GridBoard.tsx` + `GridCard.tsx` (masonry, drag-order, live-dot). `grid-warm`
cron skeleton + `/api/grid/health` cache-reader stub. Verify padlock for non-admins, admin
bypass, nothing fetches UW per request. **Ship locked.**

**Phase 1 — Free/live backbone (highest leverage).** Panel 1 Pulse (fold `tideStore` into
pulse SSE) + Panel 2 News (wire UW `news` WS → `newsStore` → SSE + `fetchBenzingaChannelFeed`)
+ Panel 3 Flow (mount `<FlowFeed compact>`, no new ingest). These are the live, RPS-free core.

**Phase 2 — Core breadth panels (cache-reader).** Panel 10 Sector Heat, Panel 6 Movers,
Panel 7 Dark Pool (surface `SpxDarkPoolCard`), Panel 9 Econ Calendar. All `/api/grid/*`
cache-readers off `grid-warm`. **Prereq:** the `fetchUwEtfInOutflow`/`fetchUwEtfTide` path
fixes for clean Sector/ETF flow.

**Phase 3 — Catalyst + positioning panels.** Panel 4 Earnings, Panel 5 Analyst Actions
(needs Benzinga channel-name fix for enrichment), Panel 11 Positioning, Panel 12
FDA/Catalysts (new market-wide FDA wrapper).

**Phase 4 — Smart money + polish.** Panel 8 Smart Money. VITALS motion pass, empty/closed
states per panel, drag-order persistence, mobile 1-col QA, live-vs-poll badge correctness.
RTH live-data QA (market-open only). Then flip `LAUNCHED_TOOLS=grid`.

**Phase 5 (optional) — Live-tape + catalysts strip.** WS `net_flow` into Positioning; WS
`option_trades`/Massive `T.` live tape enhancer for Flow; IPO calendar + unusual-congress
Phase-2 strip.

## 7. Build checklist (every panel)
- [ ] Market-wide wrapper exists (or reuse) + writes a `grid:*` Redis snapshot from `grid-warm`.
- [ ] `/api/grid/<panel>` route: cache-reader, `requireToolApi("grid")`, `{available:false}` on miss.
- [ ] Component is a `GridCard` with semantic colors, live dot, empty/closed state, no grey.
- [ ] Live panels subscribe to SSE with a poll fallback + correct `LIVE` badge.
- [ ] Mobile 1-col + `prefers-reduced-motion` verified.
- [ ] No per-request UW REST anywhere in the panel's path (cache-reader rule).
