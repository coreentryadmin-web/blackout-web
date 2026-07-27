# API-CONTRACTS.md — the real backend surface the native iOS app consumes

**Scope.** The **actual** HTTP contract the production-grade native SwiftUI app binds its
repositories to. Every route, param, auth gate, and response field below was read from the route
handler (and its loader/type) in this repo — not inferred from the UI. Where a shape is produced by
a loader whose full type wasn't exhaustively enumerated, the field is marked **VERIFY** rather than
guessed. Field names are exactly as serialized (snake_case vs camelCase is inconsistent across
routes — this doc preserves the real casing, which matters for `Codable`).

**Companion docs:** `docs/ios/INFORMATION-ARCHITECTURE.md` (screen → route map),
`docs/ios/NATIVE-VALUE-AND-PRIVACY-AUDIT.md` (native wiring truth),
`docs/ios/IOS-PREMIUM-PROGRAM.md` (backlog). This doc is the **data contract**; the IA is the
**screen map**.

There are ~180 `route.ts` files under `src/app/api/**`. This doc enumerates the **product-relevant,
member-facing** subset the app actually needs (~10–15 per desk), and explicitly flags the routes the
app must **not** build on. Admin (`/api/admin/**`), cron (`/api/cron/**`), webhooks, and
worker/health routes are out of scope except where noted as a boundary.

---

## 0. Auth model — every gate the app must satisfy

All auth lives in `src/lib/market-api-auth.ts` + `src/lib/tool-access-server.ts`. There are **five**
distinct gates; a route can stack them (tier gate **then** per-tool launch gate).

| Gate (function) | What it requires | Failure response |
|---|---|---|
| `requireTierApi("free")` | Any signed-in user (Clerk/Cognito) | `401 {error:"Unauthorized"}`, or `503` if Clerk unreachable + no cached tier |
| `requireTierApi("premium")` | Signed-in **premium** tier (admin bypasses) | `401` / `403 {error:"Forbidden — upgrade required"}` / `503` |
| `authorizeCronOrTierApi(req,"premium")` | Cron `Bearer CRON_SECRET` **OR** premium user | same as premium |
| `authorizeMarketDeskApi(req)` | = `authorizeCronOrTierApi(req,"premium")` | same as premium |
| `requireToolApi("<tool>")` / `requireAnyToolApi([...])` | Per-tool launch gate on top of tier: `spx \| heatmap \| largo \| nighthawk \| vector` | `403 {error:"coming_soon", message:"This tool is launching soon."}` |

- **Auth transport for the app:** the site is Clerk-cookie based. A request carries
  `Cookie: __session=<JWT>; __client_uat=<epoch>`. The native app authenticates via Clerk, obtains
  the `__session` JWT, and sends it on every API call (see CLAUDE.md "Access reality" — headless
  login proves this is pure-HTTP). `role:admin` (`publicMetadata.role`) bypasses per-tool gates;
  tier is `publicMetadata.tier` (Whop-driven, 60s cache). **Do not ship the Apple demo account as
  admin** (it would bypass launch gates and expose unlaunched desks).
- **Tool launch gates are real for premium users too.** Vector/Thermal/Largo/Night Hawk can return
  `403 coming_soon` even to a paying member (`canAccessTool` / per-user `tool_access` overrides in
  Clerk `publicMetadata`). The app must render a ComingSoon state on `403 coming_soon`, distinct
  from a `403 Forbidden — upgrade required` (tier) and `401` (signed-out).
- **Cron `via` branch:** `authorizeCronOrTierApi` returns `{userId:null, via:"cron"}` for cron
  callers, which some routes use to **skip** the tool gate. Irrelevant to the app (it's always
  `via:"user"`), but it's why some routes gate the tool only in the user branch.

### Cross-cutting response conventions (apply everywhere unless noted)

- **`roundFloats(...)`** wraps most market payloads — provider floats are rounded at the data layer.
  A handful of NUMERIC/string columns are coerced (`market/regime`). Treat all numeric fields as
  already-rounded `Double`; do not re-round for display trust.
- **Honest-empty contract:** market routes return **HTTP 200** with `{available:false, ...}` (never
  fabricated data) when upstream is cold/empty. Some degrade to `{degraded:true}` on transient
  upstream blips (e.g. `spx/play` returns `200 {available:false, action:"SCANNING", degraded:true}`
  instead of 502). The app must treat `available:false` and `degraded:true` as first-class states,
  not errors.
- **Freshness fields are pervasive and load-bearing** — `as_of`, `asof`, `polled_at`,
  `captured_at`, `generated_at`, `overlays_at`, `*_age_ms`, `*_stale`, `feed_stalled`, `stale`,
  `market_open`/`marketOpen`. The desk deliberately distinguishes "live" from "last good". Surface
  these; never present a `*_stale:true` value as live.
- **Cache-Control:** most desk reads send `no-store`; a few market-wide reads are CDN-cached
  (`regime` 30s, `news` 120s). SSE routes send `text/event-stream` + `no-cache` + keep-alive.
- **SSE framing:** most SSE routes send `data: {json}\n\n` lines with `type` discriminators
  (`connected`/`flow`/`heartbeat`/`ping`/`error`). **Exception:** `vector/stream` enqueues a raw
  frame (first frame = FULL snapshot, subsequent = DELTA) — see §7. `: heartbeat\n\n` comment lines
  appear on several streams.
- **WebSockets are server-side only** (UW/Polygon WS run on ECS); the browser/app gets everything
  via **SSE + polling**. Do not attempt client WS.

---

## 1. COMMAND / global market (Command tab)

The macro read. Mostly premium-gated market reads with no per-tool gate; `regime` is public,
`ticker-search` is free-tier.

| Method · Path | Params | Auth | Response shape (real fields) | Kind |
|---|---|---|---|---|
| `GET /api/market/indices` | — | premium/cron | `{source:"market", as_of:ISO, spx:{price,change_pct,…}\|null, vix:{…}\|null}` — WS spot overlaid on cached REST snapshot; `as_of` = fetch time. `502` if both null | REST poll (~1.5s ok) |
| `GET /api/market/quote` | `ticker` (req, `^[A-Z0-9.\-]{1,8}$`) | premium/cron | `{available:true, ticker, price, change_pct, source:"ws"\|"rest", asof:ISO}` or `{available:false}` (200). **Premium-gated** (not free — IA doc's "free tier" note is wrong) | REST fast-poll |
| `GET /api/market/regime` | — | **public** (no auth) | `{available, regime, gexRegime, volRegime, trendRegime, flowRegime, playbook, capturedAt, netGex, ivPercentile, aboveVwap, stale, marketOpen}` | REST (CDN 30s) |
| `GET /api/brief/premarket` | — | premium/cron | `{available, date, content, spxPrice, callWall, putWall, kingStrike, netGex, gexBias, publishedAt}` — or `{available:false, stale:true, staleDate}` when >1 session old | REST |
| `GET /api/market/flow-brief` | — | premium/cron | `{brief:string\|null, massive_signals:int, window_slot:int, next_refresh_ms:int, generated_at:ISO\|null}` — one shared Claude memo per 15-min window; `generated_at` = author time | REST |
| `GET /api/market/news` | `ticker?` | premium/cron | `{source:"news", ticker?, articles:[…]}` (Benzinga via Polygon key). `articles[]` shape **VERIFY** (`fetchBenzingaNews`) | REST (CDN 120s) |
| `GET /api/market/earnings-calendar` | — | premium/cron | `{earnings:{TICKER:"YYYY-MM-DD"}, configured:bool}` — Alpha Vantage; `503`/`{}` if key unset | REST (12h) |
| `GET /api/market/dark-pool` | `limit?≤100`, `min_premium?` | premium/cron | `{prints:[{ticker, premium, side:"buy"\|"sell"\|"neutral", executed_at, share_size?}], count}` | REST |
| `GET /api/market/dark-pool/ticker` | `ticker` | premium/cron | per-ticker dark-pool prints — shape **VERIFY** | REST |
| `GET /api/market/ticker-search` | `q` (req, `≤32`, allow-list), `limit?≤20` | **free** (signed-in) | `{results:[…]}` (Polygon search). `results[]` shape **VERIFY** (`fetchPolygonTickerSearch`) | REST |
| `GET /api/market/heatmap` | — | premium + tool `heatmap` | `{source:"market", sectors:[…], movers:[…], as_of:ISO}` — **sector/mover grid**, NOT the GEX matrix (that's `gex-heatmap`) | REST |
| `GET /api/market/option-contract` | `ticker, expiry, strike, option_type` (all req) | premium/cron | contract drilldown payload (`roundFloats`) — shape **VERIFY**; `503` if UW unset | REST |

> **Session clock** (pre/RTH/power-hour/after-hours): no route — client-derive from ET session
> helpers (`src/lib/providers/spx-session.ts`, `src/features/nighthawk/lib/session.ts`).

---

## 2. SPX SLAYER — `/dashboard` (0DTE structure desk)

Flagship. `desk`/`pulse`/`play` all share ONE cache lane (`loadSpxDesk`/`loadMergedSpxDesk`) so the
header and the play call can never diverge. Most are premium/cron with **no** per-tool gate;
`gex-positioning`/`gex-heatmap` gate on `spx OR heatmap`.

| Method · Path | Params | Auth | Response shape (real fields) | Kind |
|---|---|---|---|---|
| `GET /api/market/spx/desk` | — | premium/cron | `SpxDeskPayload` (large — see below) + `polled_at`. `502 {available:false}` on build fail | REST poll |
| `GET /api/market/spx/merged` | — | premium/cron | merged desk (desk+flow+pulse layered) — same `SpxDeskPayload` family | REST |
| `GET /api/market/spx/pulse` | — | premium/cron | `SpxDeskPulse` (sub-second tape: index/tide/dark-pool/net-flow ticks) — shape **VERIFY** | REST |
| `GET /api/market/spx/pulse/stream` | — | premium/cron | SSE of pulse ticks | **SSE** |
| `GET /api/market/spx/play` | — | premium/cron | play state (see below); `200 {available:false, action:"SCANNING", degraded:true}` on transient fail | REST poll |
| `GET /api/market/spx/pin` | — | premium/cron | `SpxPinForecast` (EOD pin projection) — shape **VERIFY**; `{available:false}` honest-empty | REST |
| `GET /api/market/spx/power-hour` | — | premium/cron | power-hour structure record — shape **VERIFY** | REST |
| `POST /api/market/spx/commentary` | body optional | premium (`requireTierApi`) | `{commentary, window_slot, next_refresh_ms}` — one shared Claude memo per window; **POST not GET** | REST |
| `GET /api/market/spx/signals` | `limit?≤200` (def 50) | premium/cron | `{rows:[…]}` recent SPX signal fires — row shape **VERIFY** (`fetchRecentSpxSignals`) | REST |
| `GET /api/market/spx/flow` | — | premium/cron | SPX-scoped flow lane — shape **VERIFY** (`loadSpxDeskFlow`) | REST |
| `GET /api/market/spx/outcomes` | `limit?≤200` (def 50) | premium/cron | `{stats, adaptive, rows:[…]}` — graded A–F 0DTE ledger (`spx_play_outcomes`); member-facing | REST |
| `GET /api/market/spx/journal` | — | premium/cron (+ user) | `{entries:{[open_play_id]:entry}}` (per-user) | REST |
| `POST /api/market/spx/journal` | `{open_play_id:int, note?, tags?}` | premium/cron (+ user) | `{entry}` | REST write |
| `GET /api/market/gex-positioning` | `ticker?` (def SPY), `intraday?=1` | premium + `spx\|heatmap` | canonical positioning (see §4 — shared with Thermal) | REST |

**`SpxDeskPayload`** (from `src/features/spx/lib/spx-desk.ts:678` — the app's biggest struct; partial,
all fields real):
```
available, as_of, source, price, spx_change_pct, vix, vix_change_pct, above_vwap,
lod, hod, vwap, vwap_volume_weighted?, pdh, pdl, prior_close, gap_pct, gap_source,
ema20/ema50/ema200, sma50/sma200, tick, trin, add, internals_estimated?{tick,trin,add},
gex_net, gex_king, max_pain, gamma_flip, above_gamma_flip, gamma_regime, gex_walls:GexWall[],
flow_0dte_call_premium, flow_0dte_put_premium, flow_0dte_net,
tide_bias, tide_call_premium, tide_put_premium, tide_net, nope, nope_net_delta, uw_iv_rank,
regime, levels:SpxDeskLevel[], dark_pool, spx_flows:SpxFlowBrief[], unified_tape:SpxTapeItem[],
opening_range?{high,low,break,forming}, strike_stacks[], net_prem_ticks[],
vix_term{vix9d,vix3m,structure,detail}, sector_heat[], leader_stocks[], oi_changes[],
iv_term_structure[], macro_events[], news_headlines[],
polled_at?, market_open?, market_status?, market_label?, data_quality?,
flow_data_age_ms?, flow_cluster_live?, price_age_ms?, feed_stalled?,
gex_age_ms?, gex_stale?, active_halts?[{symbol,halt_type,reason}], halt_channel_stale?,
lit_dark_ratio?{lit_premium,dark_premium,lit_share,updated_at}
```
`GexWall` shape **VERIFY** (`src/lib/providers/gamma-desk.ts:12`, e.g. `{strike, kind, …}`).

**`/spx/play`** (from `evaluateSpxPlayState` → `readSpxPlaySnapshot` + `playbook_shadow`). Confirmed
top-level fields: `action` (e.g. `SCANNING`/…), `phase` (e.g. `OPEN`), `score`, `grade`,
`open_play?{direction,…}`, `option_ticket`, `gates{blocks[], first_block_category}`,
`playbook_shadow{primary_playbook_id, verdicts[{primary,trigger_fired,direction,headline,thesis}]}`.
Verdict/levels sub-shape (`headline`, `thesis`, `levels{entry,target,stop,invalidation}`, `direction`,
`confirmations{passed,passed_count,total}`) lives in `spx-play-claude.ts` — **VERIFY** the exact
member-serialized nesting before binding `entry/target/stop`.

---

## 3. HELIX — `/flows` (institutional flow tape)

| Method · Path | Params | Auth | Response shape | Kind |
|---|---|---|---|---|
| `GET /api/market/flows` | `limit?≤max`, `ticker?`, `min_premium?`, `since_hours?`, `before?` (cursor), `max_dte?` | premium/cron | `{source:"cache"\|"live", flows:FlowAlert[], count, has_more, next_before:string\|null, platform_refs?{spx,nighthawk}}`; `503 {flows:[],count:0}` on fail | REST + cursor |
| `GET /api/market/flows/stream` | `ticker?` | premium/cron | SSE: `{type:"connected",ts}` then `{type:"flow", ...FlowAlert, gex_proximity?}` and `{type:"heartbeat",ts}` (25s) | **SSE** |
| `GET /api/market/anomalies` | — | premium (`requireTierApi`) | `{anomalies:[{id, detectedAt, type, ticker, detail, premium, direction, severity}]}` (last 20) | REST |

**`FlowAlert`** (from `src/lib/api.ts`): `ticker, premium, option_type, expiry, strike, direction,
score, route, alerted_at, event_at?, tape_time_estimated?, alert_id?, alert_rule?, ask_pct?, dte?,
fill_price?, underlying_price?, open_interest?, implied_volatility?, otm_pct?, gex_proximity?`
(`gex_proximity` ∈ `at_gamma_flip|at_call_wall|at_put_wall|near_call_wall|near_put_wall`, else absent).

> Tide bar / net-flow read comes from the pulse stores inside the desk payloads, not a dedicated
> flows route.

---

## 4. THERMAL — `/heatmap` (dealer gamma map)

The GEX matrix + overlays. `gex-heatmap` gates on `spx OR heatmap`; `market/heatmap` (sector grid,
§1) gates on `heatmap`.

| Method · Path | Params | Auth | Response shape | Kind |
|---|---|---|---|---|
| `GET /api/market/gex-heatmap` | `ticker?` (def SPY, `^[A-Z0-9.\-]{1,8}$`), `force?=1` (server-throttled 8s) | premium + `spx\|heatmap` | `{available, ...GexHeatmap, cross_validation, overlays{flow_by_strike, dark_pool_levels}, overlays_at:ISO\|null, nighthawk_context, shift, vex_shift, dex_shift, charm_shift}`. `available=true` only when `spot>0 && strikes.length>0`. Off-RTH the `*_shift` objects are blanked to `{available:false,status:"collecting"}` | REST |
| `GET /api/market/gex-positioning` | `ticker?` (def SPY), `intraday?=1` | premium + `spx\|heatmap` | canonical positioning (see below) | REST |
| `GET /api/market/gex-heatmap/explain` | `ticker?` (def SPY) | premium + `spx\|heatmap` | plain-English cell read — shape **VERIFY** | REST |
| `GET /api/market/gex-matrix-deltas` | **VERIFY** | premium + `spx\|heatmap` | what-changed overlay — **SSE** (`text/event-stream`) | **SSE** |

**`gex-positioning`** (confirmed via the fallback branch — the primary `getGexPositioning` returns a
superset): `{available, degraded?, ticker, spot, change_pct, asof:ISO, flip, call_wall, put_wall,
max_pain, net_gex, gamma_posture, gamma_regime_read, net_vex, vanna_posture, vanna_regime_read,
net_dex, dex_posture, dex_regime_read, net_charm, charm_posture, charm_regime_read,
nearest_wall{strike,kind,distance_pts}, distance_to_flip_pct, shift_summary, source}`.
`GexHeatmap` matrix fields (`spot, asof, strikes[], expiries[], near_term_expiries,
gex/vex/dex/charm{total, strike_totals, call_wall, put_wall, flip}`) — **VERIFY** exact keys in
`src/lib/providers/polygon-options-gex.ts`.

---

## 5. LARGO — `/terminal` (AI desk analyst)

| Method · Path | Params | Auth | Response shape | Kind |
|---|---|---|---|---|
| `POST /api/market/largo/query` | `{question (≤4000), session_id?}`; `?stream=1` or `Accept: text/event-stream` for SSE | premium + tool `largo` | **SSE:** `{type:"ping"}` heartbeats (12s) + streamed events from `runLargoQueryStream`, terminal `{type:"error",message}`. **JSON:** `runLargoQuery` result object. Gated by per-user concurrency (2), daily budget (`429`), org spend kill-switch + concurrency ceiling (`503`) | **SSE** or REST |
| `GET /api/market/largo/session` | `session_id` (req) | premium + tool `largo` | prior Q&A for the session — payload shape **VERIFY**; `400` if no `session_id`, `503` if Largo unconfigured | REST |

Error taxonomy the app must handle distinctly: `429` (concurrency / daily cap), `503` (org paused /
peak capacity / unconfigured), `502` (query failed), `400` (bad body / too long).

---

## 6. NIGHT HAWK + 0DTE — `/nighthawk` (overnight playbook + 0DTE board)

All gate on tool `nighthawk` (the 0DTE board rides the same gate). `authorizeCronOrTierApi` +
`requireToolApi("nighthawk")`.

| Method · Path | Params | Auth | Response shape | Kind |
|---|---|---|---|---|
| `GET /api/market/nighthawk/edition` | `date?=YYYY-MM-DD` | premium/cron + `nighthawk` | `NightHawkEdition` (below); `NO_STORE` + CDN-no-store | REST |
| `GET /api/nighthawk/play-status` | `date?` | premium/cron + `nighthawk` | `{available:false, date, reason}` (200 = "not yet run") or `{available:true, ...MorningConfirmResult}` (per-play CONFIRMED/DEGRADED/INVALIDATED); `503` if Redis unset | REST |
| `GET /api/market/nighthawk/record` | `days?` (7–90, def 30) | premium/cron + `nighthawk` | `{window_days, total_resolved, pending_count, win_rate_pct, profitable_rate_pct, avg_return_pct, methodology, unfilled_count, pulled_count, stop_data_unavailable_count, segments{current,legacy}, …}` | REST |
| `POST /api/market/nighthawk/play-explain` | body **VERIFY** | premium/cron + `nighthawk` | full thesis for one play — shape **VERIFY**; **POST** | REST |
| `POST /api/market/nighthawk/hunt` | body **VERIFY** | premium/cron + `nighthawk` | trigger a fresh scan + results — shape **VERIFY**; **POST** | REST |
| `GET /api/market/zerodte/board` | — | premium/cron + `nighthawk` | `ZeroDteBoardPayload` (below); `{available:false, degraded:true}` on fail | REST poll |
| `GET /api/market/zerodte/marks` | **VERIFY** | premium/cron + `nighthawk` | live per-contract marks for ledger rows — shape **VERIFY** | REST |
| `GET /api/market/zerodte/marks/stream` | **VERIFY** | premium/cron + `nighthawk` | SSE live marks push | **SSE** |
| `GET /api/market/lotto/today` | — | premium/cron | today's lotto candidates — shape **VERIFY** (`fetchLottoPlaysForDate`) | REST |

**`NightHawkEdition`**: `{available, edition_for:string\|null, published_at:string\|null,
recap_headline, recap_summary, market_recap?, plays:PlaybookPlay[], recap_only?, degraded?, stale?,
served_for?, carry_until_close?}`.
**`PlaybookPlay`**: `{rank, ticker, direction, conviction, play_type:"stock"|"index"|"etf", thesis,
key_signal, entry_range, target, stop, options_play, entry_premium?, entry_cost_per_contract?,
premium_cap_ok?, risk_note?, score?, flow_streak_days?, iv_rank?, rr_ratio?, pulled?, pulled_reason?,
gate_promoted?, gate_warnings?[]}`.
**`ZeroDteBoardPayload`**: `{available:true, as_of:ISO, upstream_ok, session{date, trading_day,
heat}, setups:EnrichedZeroDteSetup[], ledger:ZeroDteBoardLedgerRow[], covered_elsewhere:string[],
governor:ZeroDteGovernorSummary\|null}`. Ledger row carries `ticker, direction, score_max, spike,
first_flagged_at, mark, mark_as_of, mark_source, tier?, cortex?, …` (full row **VERIFY** in
`src/lib/platform/zerodte-service.ts`).

---

## 7. VECTOR — `/vector` (gamma-wall radar)

The richest surface. Every route: `authorizeMarketDeskApi` + `requireToolApi("vector")` + ticker
allow-list (`isVectorTickerAllowed` → `400 {error:"Invalid ticker"}`). `dte` param normalizes to
`0DTE | weekly | monthly | all` (`normalizeDteHorizon`).

| Method · Path | Params | Response shape | Kind |
|---|---|---|---|
| `GET /api/market/vector/stream` | `ticker` (req) | **SSE, non-standard framing.** First frame = FULL `VectorStreamPayload`; subsequent = DELTA frame; `: heartbeat\n\n` every 15s. `503` if `SSE_MAX_STREAMS` exceeded | **SSE** |
| `GET /api/market/vector/bars` | `ticker` (req) | `{ticker, sessionYmd, bars:[…], available:bool}` — closed-minute backfill for SSE reconnect | REST |
| `GET /api/market/vector/walls` | `ticker`, `dte?` | `{ticker, horizon, walls:GexWalls, flip:number\|null}` | REST/toggle |
| `GET /api/market/vector/gex-ladder` | `ticker`, `dte?` | `{ticker, spot, asOf:ISO\|null, horizon, ladder:GexLadder}` | REST/toggle |
| `GET /api/market/vector/max-pain` | `ticker`, `dte?` | `{ticker, horizon, maxPain:number\|null, spot:number\|null}` | REST/toggle |
| `GET /api/market/vector/expected-move` | `ticker`, `dte?` | `{ticker, horizon, expectedMove:{atmIv, dteDays, spot, movePct, bands:[{sigma,low,high,movePts}], expiry}\|null}` | REST/toggle |
| `GET /api/market/vector/prior-day` | `ticker`, `anchor?=YYYY-MM-DD` | `{ticker, pdh, pdl, pdc}` | REST |
| `GET /api/market/vector/wall-history` | `ticker`, `dte?`, `session?` | `{ticker, horizon, sessionYmd, history:[…]}`; empty when `dte=all` or no `session` (all-rail is SSR-seeded) | REST |
| `GET /api/market/vector/flow` | `ticker`, `dte?` | `{ticker, horizon, available, prints:[{strike, side, premium, size, ts, …}]}` — honest-empty | REST/toggle |
| `GET /api/market/vector/universe` | `force?=1` (cron only) | `{updatedAt:epoch, rows:VectorUniverseRow[]}` — scanner grid | REST |
| `GET /api/market/vector/spy-volume` | **VERIFY** | SPY volume context — shape **VERIFY** | REST |
| `GET /api/market/vector/gex-heatmap` | **VERIFY** | Vector-scoped GEX heatmap — shape **VERIFY** | REST |

**`VectorStreamPayload`**: `{ticker, candle, walls:GexWalls\|null, vexWalls:GexWalls\|null,
gammaFlip:number\|null, vexFlip:number\|null, darkPoolLevels:[…], darkPoolAsOf:epoch, t:epoch,
gexAsOf:epoch, vexAsOf:epoch, wallHistory:[…], sessionYmd}`.
**`GexWalls`**: `{callWalls:GexWallLevel[], putWalls:GexWallLevel[]}`; **`GexWallLevel`**:
`{strike:number, pct:number}` (both ranked strongest-first).
**`GexLadder`**: `{rows:GexLadderRow[], maxAbs:number, …}`; **`GexLadderRow`**: `{strike, netGex,
side:"call"|"put", magnitude∈[0,1], isKing}` (rows sorted descending by strike).
**`VectorUniverseRow`**: `{ticker, spot, gammaFlip, vexFlip, topCallWall, topPutWall, topCallPct,
topPutPct, asOf:epoch}` (all nullable).

> **Vector alerts are localStorage-only today** (`vector-alerts.ts`, `AlertKind =
> "wall-touch"|"flip-cross"`) — no server route. See §10 gap list.

---

## 8. SIGNALS / lifecycle / track-record

**Trap to avoid:** `/api/signals/{open,outcome,record}` and the `signal_events`/`signal_outcomes`
tables are **ORPHANED** — cron-gated (`isCronAuthorized`) and **never written in production** (see
route header comments + `docs/audit/FINDINGS.md`). **Do NOT build the native Signals tab on them.**

Live lifecycle data comes from real ledgers/state, all already listed above:
- Live SPX play state — `GET /api/market/spx/play` (§2).
- Graded SPX ledger — `GET /api/market/spx/outcomes` (§2).
- Night Hawk edition + morning-confirm — `/nighthawk/edition`, `/nighthawk/play-status` (§6).
- Night Hawk graded record — `/nighthawk/record` (§6).
- 0DTE board + graded ledger — `/zerodte/board` (§6).
- Coaching — `GET /api/coaching/alerts` (premium/cron): `{alerts:[{trigger, alert, urgency,
  generatedAt, ageMs, …}]}` (last 10). Exact row **VERIFY**.
- Blended accuracy — `GET /api/platform/intel` (premium/cron): `{regime, anomalies[], coachingAlerts[],
  lastBrief, signalAccuracy{SPX_SLAYER{total,wins,winRate}, NIGHT_HAWK{…}}, regimeAccuracy:[]
  (intentionally empty), intelligence{currentRegime, currentRegimeProfitable, criticalAnomalyCount,
  urgentCoachingCount, signalRecommendation}, timestamp}`.

**Admin-only track-record (NOT member-facing):** `GET /api/public/track-record`,
`GET /api/track-record`, `GET /api/track-record/plays` all require `requireAdminApi` — the legacy
`/track-record` page redirects to admin. The **member** graded view must be built on the desk
outcome routes above, not these.

> A unified **member lifecycle feed API is MISSING** — proposed `/api/signals/live` composing
> `spx/play` + Night Hawk edition/confirm + zerodte board + outcome ledgers, tier-gated (NOT the
> orphaned cron routes). See IA §4 / §9.

---

## 9. ACCOUNT / auth / membership / push / alerts

| Method · Path | Auth | Response shape | Notes |
|---|---|---|---|
| `GET /api/auth/me` | any (signed-in or not) | `{signedIn, userId, email, firstName, lastName, tier, role}` or `{signedIn:false, userId:null, email:null}` | Works for Clerk **and** Cognito. The app's identity bootstrap |
| `POST /api/membership/sync` | signed-in (Clerk) | `{ok:true, tier, updated:int}`; `429` (cooldown, `Retry-After`), `400` (no email), `500` | Whop re-sync; **read-only tier display only, no purchase UI (3.1.1)** |
| `GET /api/account/personal-alerts` | premium | `{configured:bool, host:string\|null}` (redacted; webhook never returned) | Personal Discord webhook |
| `PUT /api/account/personal-alerts` | premium | `{ok, configured:true, host}`; `400 INVALID_WEBHOOK` | body `{url}` (https discord webhook) |
| `DELETE /api/account/personal-alerts` | premium | `{ok, configured:false}` | clears webhook |
| `POST /api/push/subscribe` | signed-in (Clerk) | `{ok:true}`; `503` if DB unset | body `{endpoint, keys{p256dh, auth}}` — **web-push, inert in WKWebView**; IDOR-guarded per user |
| `DELETE /api/push/subscribe` | signed-in | `{ok:true}` | body `{endpoint}` |
| `POST /api/push/send` | **admin only** | `{ok, sent, pruned}` — **INERT: returns `501` unless VAPID keys + `web-push` pkg present** | Not for app use; APNs is the required native path |

**Native reality (see NATIVE-VALUE-AND-PRIVACY-AUDIT):** the entire push path is **web-push**,
which does not function in a Capacitor WKWebView. There is **no APNs token/register/table/sender** —
the native app must build APNs (new token table parallel to `push_subscriptions`, server sender).
Face ID app-lock, deep links, and `/privacy` are also **missing**. Clerk `<UserProfile>` powers the
profile screen; membership is read-only.

---

## 10. Gaps the app must build server-side (not present today)

Ordered by IA leverage (see INFORMATION-ARCHITECTURE.md §9):
1. **Member lifecycle feed** (`/api/signals/live`, proposed) — Signals inbox/detail. Do **not** use
   orphaned `/api/signals/*`.
2. **Server-persisted watchlist + alert store** — alerts are localStorage today (Vector only),
   fire client-side only while the chart is open.
3. **APNs push** — the delivery mechanism; web-push is inert in-app.
4. **Deep-link routing** — `@capacitor/app appUrlOpen` unused; pushed alert can't open a setup/desk.
5. **Face ID app-lock**, **`/privacy` page** — Account tab + Apple hard-blocker.
6. **Command aggregator + session clock** — compose existing market APIs; no new route needed.

---

## 11. Verification checklist before binding `Codable` structs

- **VERIFY** the exact serialized nesting of `/spx/play` levels (`entry/target/stop/invalidation`)
  and `confirmations` (`spx-play-claude.ts` / `readSpxPlaySnapshot`).
- **VERIFY** `GexHeatmap` matrix keys (`polygon-options-gex.ts`) and `GexWall` (`gamma-desk.ts`).
- **VERIFY** shapes marked VERIFY above: `spx/pulse`, `spx/pin`, `spx/power-hour`, `spx/signals`
  rows, `spx/flow`, `news` articles, `ticker-search` results, `option-contract`, `dark-pool/ticker`,
  `largo/session`, `nighthawk/play-explain`, `nighthawk/hunt`, `lotto/today`, `zerodte/marks(+stream)`,
  `coaching/alerts` rows, Vector `spy-volume` / `gex-heatmap`, `ZeroDteBoardLedgerRow`.
- **Casing is inconsistent** — SPX desk/positioning/heatmap use snake_case; `regime`/`brief`/
  `auth/me`/`platform-intel` use camelCase. Bind field-by-field; do not assume a global convention.
- **Every market read can return `{available:false}` at HTTP 200** — model it as a loaded-but-empty
  state, and honor `stale`/`degraded`/`*_stale`/`feed_stalled`/`*_age_ms` freshness flags.
- Live/verify shapes against staging with a temp Clerk `__session` cookie (see CLAUDE.md "Access
  reality") before freezing the SwiftUI models.
