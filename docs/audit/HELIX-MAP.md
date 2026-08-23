# HELIX-MAP — the inventory

**Lane:** HELIX (owner). **Phase 0 deliverable** of `docs/agents/briefs/helix.md`. Living document —
keep it current forever after; a field added to the tape or to a Largo payload without a row here is
an undocumented field.

**Status:** first pass, written 2026-08-22 (Sat, market closed) from the tree at `9b20b63`. Every
line/threshold below was read out of the source on that commit.

**Measured live the same day** against production, read-only, via `scripts/audit/helix-tape-inventory.mjs`
(committed alongside this map — HELIX had no harness at all before it). One 5000-row / 168h member
tape. Numbers sourced from that run are marked **`MEASURED 2026-08-22`**; numbers carried from an
earlier run keep their own date; anything still unmeasured is marked **`UNVERIFIED-LIVE`** rather
than asserted. The market was closed, so this measures a *settled* tape — an RTH re-run is queued
(§12) and some ratios will move.

> **Finding IDs (§9.1 … §9.9) are stable identifiers, cited from the PR thread and from the
> harness source. They do not track the section numbers above them** — the findings live under
> §11. Do not renumber them.

**The rule this file is written under:** where provenance could not be established, the row says
**UNKNOWN**. An honest gap is a finding; a plausible guess is a lie that outlives whoever wrote it.

---

## 0. What HELIX is

The options-flow / dark-pool tape reader: what is actually trading, in what size, at what
aggression, and whether it stacks into a repeatable signal. Member surface is `/flows`.

Two things it is NOT, and both matter for reading the tables below:

- It is **not a live market-data feed**. Every number on `/flows` is a read of the Postgres
  `flow_alerts` table, which is written by an ingest path. The UI's own "LIVE" badge measures the
  age of the newest *print*, not the health of the connection.
- It is **not a full tape**. Two independent caps bind before the requested window does — a
  persistence floor at ingest (§4) and a row `LIMIT` at read (§5). Both are load-bearing and both
  have produced defects that reached members.
- It is **not one tape**. Two producers with different payload schemas write `flow_alerts`, split
  cleanly rather than statistically, and 70% of rows come from a feed covering only SPX and SPY.
  **Read §4A before trusting any HELIX aggregate** — several of them cannot be interpreted without
  it.

---

## 1. Coordinates — verified 2026-08-22

| Area | Where | Note |
|---|---|---|
| Member route | `/flows` → `src/app/(site)/flows/page.tsx` (14 lines) | `requireTier("premium")`, `force-dynamic`, noindex |
| Page frame | `src/features/helix/components/HelixPageShell.tsx` | tide bar + `FlowFeed` (dynamic, `ssr:false`) |
| Main container | `src/features/helix/components/FlowFeed.tsx` — **1155 lines** | owns fetch, SSE, merge, filters, and every panel's props |
| Feature lib | `src/features/helix/lib/` — 25 files | largest: `helix-table-columns.ts` 278, `helix-flow-format.ts` 214, `helix-skew-baseline.ts` 166, `helix-signal-outcome-summary.ts` 137, `helix-signal-detection.ts` 111 |
| Components | `src/features/helix/components/` — 27 files | largest: `FlowFeed` 1155, `HelixFlowTable` 541, `ContractDrilldownDrawer` 431, `HelixCommandBar` 416, `DarkPoolPanel` 401 |
| Shared lib | `src/lib/helix/` | `contract-drilldown-parse.ts`, `occ-contract-id.ts` |
| Member APIs | `GET /api/market/flows`, `GET /api/market/flows/stream` (SSE), `GET /api/market/helix/signal-outcomes` | |
| Admin API | `GET /api/admin/helix/health` → `src/lib/admin-helix-health.ts` | 4 legs, fail-open per leg |
| Crons | `helix-signal-outcomes` (registered), `helix-discord-digest` (**NOT scheduled** — see §9.1) | |
| Store | Postgres `flow_alerts` (+ `helix_signal_outcomes` ledger, `platform_meta` ingest cursor) | |
| Largo tools owned | `get_helix_derived`, `get_helix_tape_analytics`, `get_helix_signal_outcomes`, `get_helix_thermal_compare` | last one is a **shared** Helix/Thermal surface — coordinate before editing |

**Correction to the charter:** the charter lists `helix-discord-digest` among the crons this lane
owns. The route exists and is complete, but it is in `cron-registry.test.ts`'s
`INTENTIONALLY_UNREGISTERED` map ("Unscheduled in cron-jobs.json") and **no code path in `src/`
invokes it**. It is owned, but it is not running. See §9.1.

---

## 2. The pipeline, end to end

```
UW flow_alerts (WS primary / REST cursor fallback / external Python bot when FLOW_INGEST_BOT_PRIMARY=1)
  → parseUwFlowAlert            (unusual-whales.ts)      derives option_type/direction/route/SCORE
  → persistAndPublishFlowAlert  (flow-persist.ts)        DTE-aware premium FLOOR, alert_id dedup
      ├─ INSERT flow_alerts (raw_payload kept verbatim)
      └─ publish → Redis channel → SSE  (/api/market/flows/stream)
  → fetchRecentFlows            (db.ts ~2559)            the SQL that DERIVES most displayed fields
  → enrichFlowsWithGex          (flow-gex-enrichment)    gex_proximity, best-effort, 300ms/ticker
  → readFlowsMemberCached       (flows-member-cache)     60s TTL, 800ms max-block, stale handoff
  → GET /api/market/flows       (route.ts)               roundFloats, NO_STORE
  → FlowFeed                    (client)                 merge REST page + SSE head, filter, sort
  → 16 tape columns + 14 panels
```

Parallel branch, same table:

```
flow_alerts (last 1h)
  → detectVelocitySpikes / detectSplitFlow   (helix-signal-detection.ts — ONE definition, shared)
  → recordHelixSignalFirings                 (helix-signal-outcomes-job.ts)  INSERT firing
  → gradeHelixSignalOutcomes                 (same file)  Polygon minute bars at +5m/+15m/+1h
  → GET /api/market/helix/signal-outcomes    → SignalOutcomeTracker panel + get_helix_signal_outcomes
```

And the Largo branch, which reads the same fetch builder but **not** the same population as the
desk (§8):

```
helixTapeFetchOptions  →  marketPlatform.flows.getFlowTapeSummary
  → helixTapeAnalyticsForLargo   (product-reads.ts:1072)  get_helix_tape_analytics
  → helixDerivedForLargo         (product-reads.ts:867)   get_helix_derived
```

---

## 3. Time model — three different timestamps, and which one is authoritative for what

This is the single most defect-dense area of HELIX and every consumer must pick deliberately.

| Field | What it is | Set by | Null/empty when |
|---|---|---|---|
| `event_at` | **Real UW print time.** `raw_payload.created_at`, else `executed_at`, else `start_time` epoch | `resolveFlowTimes` (`flow-timestamp.ts`) | UW sent no timestamp at all |
| `alerted_at` | **Display time.** `event_at` if known, else INGEST time (`inserted_at`) | same | `""` on the REST path when neither exists |
| `tape_time_estimated` | `true` ⟺ `alerted_at` is ingest time, i.e. **this row has no real print time** | same | — |

Rules currently enforced in code:

- **Freshness / LIVE / STALE uses `flowEventTimeMs` only** — real print time, never the ingest
  fallback. `FlowFeed.tsx:721-752`. A row with `tape_time_estimated` is excluded from the age
  calculation entirely.
- **The TIME column and the tape sort use `flowTimeMs`** (`helix-flow-format.ts:16`), which reads
  `alerted_at` — so an ingest-stamped row *is* placed on the tape, at its ingest time, and is
  simply not allowed to affect the freshness badge.
- **Largo's `window` block uses `flowEventTimeMs`**, deliberately — `helix-tape-analytics.ts`
  documents that reading `alerted_at` instead reported a tape 27 minutes fresher than it was.
- **`tape_time_estimated` is routinely the MAJORITY of the tape** — but it is **not a property of
  the tape**. `MEASURED 2026-08-22`: **3500 of 5000 rows (70.0%)** carry no real UW print time
  (2026-08-20 recorded 438/500 = 87.6% on a smaller page). The share moves because it is a **mix
  ratio between two writers**, not a per-row accident: every timeless row comes from one producer
  and every timed row from the other, with no overlap. See §4A — reading this number as "prints
  sometimes lack a timestamp" is the specific mistake that section exists to prevent.

**Session anchoring (contract C1).** ET, never UTC:
- SQL `dte` = `expiry - (NOW() AT TIME ZONE 'America/New_York')::date` — ET-anchored ✅
- SQL `route` `'0dte'` branch = `expiry = (NOW() AT TIME ZONE 'America/New_York')::date` — ET ✅
- `daysToExpiry()` (client fallback) — ET calendar via `Intl` `en-CA` ✅
- Largo payloads carry `as_of` = `etStamp(...)` and `session_date` = `etSessionDate(...)` ✅
- **`parseUwFlowAlert`'s `dte`/`route` (ingest, `unusual-whales.ts:270`) — UTC-anchored ❌** (§9.2)
- **`dteFromExpiry` (persist floor, `flow-persist.ts:42`) — UTC-anchored ❌** (§9.2)

---

## 4. Ingest — what never reaches the tape at all

| Gate | Value | Where | Consequence |
|---|---|---|---|
| Premium floor, ≥2 DTE | `UW_FLOW_MIN_PREMIUM`, default **$200,000** | `flow-persist.ts:18` | never persisted, never visible anywhere |
| Premium floor, 0–1 DTE | `UW_FLOW_MIN_PREMIUM_0DTE`, default **$50,000** | `flow-persist.ts:30` | deliberately lower — an 0DTE contract's premium is small even for a large directional bet (FINDINGS 2026-08-04) |
| Upstream fetch floor | `min(MIN_PREMIUM, MIN_PREMIUM_NEAR_DATED)` = **$50,000** | `flow-persist.ts:54` | fetch at the LOWER floor so near-dated prints survive to the per-row DTE-aware gate |
| Dedup | `alert_id` UNIQUE, `ON CONFLICT` | `insertFlowAlert` | |
| Cursor | `platform_meta.uw_flow_cursor` (UW-native `created_at` string) + `uw_flow_cursor_max_id` | `flow-ingest.ts` | comment warns: never mix epoch `start_time` into the ISO cursor |
| Cross-replica | `pg_try_advisory_lock("flow-ingest")` | `flow-ingest.ts` | non-blocking; loser returns immediately |

**Ingest source precedence** (`runFlowIngest`): external Python bot if `FLOW_INGEST_BOT_PRIMARY=1` →
else skip REST when (PG tape fresh **AND** local WS `flow_alerts` OPEN **AND** channel fresh <120s) →
else skip REST when (PG tape fresh **AND** any *other* replica's Redis heartbeat fresh <120s) → else
REST poll, `limit: 100`, `newer_than: cursor`. Poll interval `UW_FLOW_POLL_SEC`, default **45s**.

The `pgTape.fresh` conjunct is load-bearing and was added for a measured failure: a stale cluster
heartbeat used to silence REST while `flow_alerts` had stopped receiving rows (`ws_active_cluster`
false-green).

---

## 4A. THE TWO WRITERS — the structural fact underneath most of this map

`MEASURED 2026-08-22`, one 5000-row / 168h member tape, via `scripts/audit/helix-tape-inventory.mjs`.

The HELIX tape is written by **two producers with different payload schemas**, and the boundary
between them is **exact, not statistical**:

```
cross-tab  event_at x alert_rule
  both present : 1500      event_at only : 0
  alert_rule only : 0      neither      : 3500
```

Zero rows in either off-diagonal cell. That is a schema boundary, not a distribution.

| | **Group A** — UW `flow_alerts` | **Group B** — index-only feed |
|---|---|---|
| Rows | 1500 (30%) | 3500 (70%) |
| Tickers | **273** | **2 — SPX and SPY only** |
| `event_at`, `alert_rule`, `open_interest`, `underlying_price`, `otm_pct` | **100%** | **0%** |
| `ask_pct` | 96.9% | 0% |
| `implied_volatility` | **0%** | **100%** |
| `fill_price`, `alert_id`, `score` | 100% | 100% |
| Total premium | $854,960,120 | **$9,992,246,317** |
| Median premium | $258,408 | $522,348 |

**Group B carries 92.1% of all premium on the tape**, from two tickers.

**Hypothesis for Group B's identity, stated as a hypothesis:** `flow-ingest.ts` documents an
external Python bot that "writes to the shared Postgres and publishes to the
`blackout:flow-events` Redis channel" when `FLOW_INGEST_BOT_PRIMARY=1`, bypassing REST ingestion
entirely. A second producer writing rows directly with its own payload shape fits every observation
here. **UNKNOWN** — that bot's source is not in this repo and nothing was read to confirm it. Do not
state it as fact without checking.

### Three consequences that change how HELIX numbers must be read

**(a) SPX and SPY can NEVER fire either persisted HELIX signal.** `detectVelocitySpikes` skips any
row without `event_at`; `detectSplitFlow` filters on `flowEventTimeMs`, which returns null for the
same rows. Group B has no `event_at`, so **only 30% of the tape is signal-eligible at all**, and the
excluded 70% is precisely SPX and SPY. Neither detector is wrong — each is correctly refusing to
date a print it cannot date. But the product has a population that **dominates every premium panel
while being invisible to every time-based signal**, and nothing anywhere says so.

**(b) The Net Premium leaderboard is decided by Group B.** `MEASURED`: SPX **$9,984,228,007** vs
TSLA $40,522,361 — a **246×** gap, and SPX's total is ~99.9% Group B rows. The leaderboard is not
wrong about the arithmetic; it is answering "which name saw the most premium" with a number
dominated by one feed that only covers two tickers. Same for session skew, expiry concentration and
route breakdown, all of which sum over both groups.

**(c) Half the tape's columns are structurally blank per group, not per row.** A member scanning
`/flows` sees Ask%, OI, Spot, OTM% and Rule populated on equity names and **always empty on SPX/SPY**
— and IV populated **only** on SPX/SPY. That is legible as a data-quality problem when it is
actually two feeds. `UNVERIFIED-LIVE`: whether the UI communicates this at all (no HELIX UI harness
existed until now — §10).

### A hypothesis this map raised and the measurement KILLED

Group B's largest print is **$1,307,530,000** — $1.3 billion on one SPX contract. That read as an
obvious units error (notional booked as premium), which would have meant every SPX premium number in
HELIX was inflated ~100×. **It is not an error.** `premium = fill × 100 × contracts` reproduces it
exactly: 14,000 × 100 × $933.95 = $1,307,530,000. Implied contract counts across Group B top out at
**14,000** (median 32), comfortably inside what SPX bears; Group A's max is 100,000. The premium
field is internally consistent in both groups.

Recorded because the wrong hypothesis is as much a part of the map as the right one: **a number
being astonishing is not evidence that it is wrong**, and `impliedContracts()` in
`lib/helix-tape-inventory-eval.mjs` is now the cheap check that separates the two.

---

## 5. Read — the caps that bind before the window does

| Knob | Value | Where |
|---|---|---|
| Page size (initial + "load older") | **500** | `HELIX_FLOW_PAGE_SIZE` |
| Hard max rows per request | **5000** | `HELIX_FLOW_MAX_LIMIT` |
| Default lookback | **168h (7 days)** | `HELIX_FLOW_DEFAULT_SINCE_HOURS` |
| Max lookback accepted | **720h (30 days)** | `HELIX_FLOW_MAX_SINCE_HOURS` |
| Member-panel display floor | **$200,000** | `HELIX_MEMBER_PANEL_PREMIUM_FLOOR` (= `FlowFeed`'s `FLOOR_PREMIUM`) |
| Whale threshold | **$1,000,000** | `WHALE_PRINT_PREMIUM` |
| Member cache TTL | **60s** (`FLOWS_CACHE_SEC`) | `flowsCacheTtlMs()` |
| Max block before stale handoff | **800ms** (`FLOWS_MEMBER_READ_MAX_BLOCK_MS`) | `flowsMemberReadMaxBlockMs()` |
| Client poll | **30s** | `FLOW_POLL_MS` |
| SSE heartbeat | **25s**; max **500** streams/instance (`SSE_MAX_STREAMS`) | stream route |
| GEX enrichment | ≤**100** distinct tickers/page, **300ms** per-ticker timeout, **60s** per-ticker cache | `flow-gex-enrichment.ts` |

**The limit almost always binds before the window.** Recorded measurement (2026-08-20,
`helix-tape-analytics.ts`): a **168-hour** request at `limit: 500` returned 500 rows spanning
**54 minutes**; at `limit: 5000` the span was 5.4 hours, still not 168. This is why every Largo tape
payload carries `window.actual_hours` / `window.actual_minutes` / `window.limit_reached` and why the
tool descriptions forbid quoting `requested_hours` as the analysed period.

**Ordering selects the population, not just the sort.** `fetchRecentFlows` has two hardcoded
`ORDER BY`s — `recent` (COALESCE(created_at, inserted_at) DESC) and `premium` (total_premium DESC).
Which one runs decides *which rows survive the LIMIT*. Measured 2026-08-20 at the same 400-row cap,
premium-ordered vs recent-ordered overlapped **0 of 10** stacked hits and **0 of 12** top prints —
identical counts, disjoint contents, inverted direction. Both HELIX Largo tools now pin
`order: "recent"` through `helixTapeFetchOptions`.

---

## 6. Field inventory — the tape row

Source of every row: `fetchRecentFlows` (`db.ts:2559`), then `enrichFlowsWithGex`. "Raw" means
`flow_alerts` column; "raw_payload" means derived in SQL from the verbatim UW JSON.

| Field | Column shown | Units | Source | How derived | Unavailable when | Also consumed by |
|---|---|---|---|---|---|---|
| `ticker` | Symbol | — | raw | UW `ticker`, uppercased | never (empty string if UW omitted) | every panel, leaderboard, drawer, Largo identity |
| `premium` | Premium | USD | raw `total_premium` | `COALESCE(total_premium, 0)` | 0 when UW omitted | skew, leaderboard, route breakdown, whale flag, Discord |
| `option_type` | Side | CALL/PUT | raw | uppercased | can be neither → **typeless print** (counts in `alert_count`, in NEITHER premium leg) | skew, split-flow, expiry split |
| `expiry` | Expiry | ET date | raw | `TO_CHAR(expiry,'YYYY-MM-DD')` | `""` | DTE, horizon bucket, stacks |
| `strike` | Strike | USD | raw | | 0 | stacks, GEX proximity, OTM% |
| `direction` | (badge colour) | bullish/bearish/unknown | **derived in SQL** | `option_type LIKE 'c%'`→bullish, `'p%'`→bearish, else unknown | never | Discord, drawer |
| `score` | Score | 0–100 | **derived at INGEST** | `min(60, premium/$1M×60) + 25·hasSweep + 15·is0DTE`, capped 100; UW's own `score` used if >0 | 0 | tape sort, Discord digest rank (`score≥5`) |
| `route` | (0DTE badge in TickerDrawer) | whale/0dte/stock | **derived in SQL on REST**, **at ingest on SSE** | REST: premium≥$1M→whale, `expiry = ET today`→0dte, else stock | never | TickerDrawer badge, ingest score bonus |
| `alerted_at` | Time | ISO → `MM/DD/YYYY - HH:MM` ET | `resolveFlowTimes` | print time else ingest time | `""` when neither | tape sort, `flowTimeMs` |
| `event_at` | — | ISO | `resolveFlowTimes` | UW print time only | `null` on ~88% of rows (§3) | LIVE badge, velocity, split, Largo `window` |
| `tape_time_estimated` | — | bool | `resolveFlowTimes` | true ⟺ `alerted_at` is ingest | — | freshness exclusion |
| `dte` | DTE | calendar days | **derived in SQL** | `expiry - (NOW() AT TIME ZONE 'America/New_York')::date` — **can be negative** (expired) | `undefined` if expiry null | horizon bucket, DTE filter, Discord ≤30 filter |
| `fill_price` | Fill | USD/contract | raw_payload `price` | string-tolerant numeric cast | `undefined` when absent/non-numeric | Discord filter (`fill < $10`) |
| `underlying_price` | Spot | USD | raw_payload `underlying_last` → `underlying_price` → `stock_price` | first numeric-looking of the three | `undefined` | OTM%, `price_at_fire` on signal firings |
| `ask_pct` | Ask% | 0–100 | raw_payload | `ask_side_pct` if numeric, **else derived**: `ask/(ask+bid) × 100` from `total_ask_side_prem`/`total_bid_side_prem` | `undefined`; `NULLIF` guards ÷0 → NULL, never 0 | aggression reads; 0DTE `board.ts` aggressionWeight |
| `open_interest` | OI | contracts | raw_payload `open_interest` → `oi` | | `undefined` | drawer |
| `implied_volatility` | IV | % (or fraction — see below) | raw_payload `iv` → `implied_volatility` | | `undefined` | drawer |
| `otm_pct` | OTM | % | **derived in TS** | call: `(K − S)/S`, put: `(S − K)/S`, ×100, 1dp. **Only for a real call/put** — a typeless row returns `undefined` rather than silently taking the put branch | `undefined` when spot or strike ≤0, or side unknown | drawer |
| `alert_rule` | Rule | label | raw_payload `alert_rule` → `rule_name` | `NULLIF(...,'')` | `undefined` | **Route Breakdown panel** (`executionRouteKey`), rule badge |
| `alert_id` | — | id | raw | canonical UW id | `undefined` on some DB-served REST rows | client dedup, deep links |
| `gex_proximity` | Signals badges | enum | **derived post-fetch** | `at_*` = within **0.15%** of level, `near_*` = within **0.5%**; flip → call wall → put wall precedence | absent — **and absence is ambiguous** (§9.3) | FLIP / C WALL / P WALL badges |

**`ask_pct` is worth its own note.** UW does **not** send `ask_side_pct` on flow_alerts (live-verified
2026-07-24: 0 of 2780 rows) but does send both premium legs on 100% of rows. The SQL derivation is
the mirror of `askPctFromTwoSidedPremium()` on the SSE path; the two **must** stay identical or REST
rows and SSE rows disagree about aggression on the same print.

**`implied_volatility` units are UNKNOWN at the data layer.** `fmtIv` renders `iv < 3` as
`iv × 100` and otherwise as `iv` — i.e. it *guesses* whether UW sent a fraction or a percentage per
row. That heuristic is undocumented upstream and untested against UW's actual contract. Recorded as
an open question, not a defect, until measured (§9.4).

---

## 7. Field inventory — panels

The panels below render from `displayAlerts` (the filtered, recency-sorted client buffer) unless noted.
`marketWidePanels` (`showMarketWideAnalyticsPanels`) hides the market-wide ones when a ticker filter
is active, so a scoped tape cannot masquerade as a market read.

| Panel | Metric shown | Derivation | Absence rule |
|---|---|---|---|
| **Tape** (`HelixFlowTable` / `HelixMobileFlowTape`) | 16 columns (§6), 3 densities (essential/standard/full) | virtualized, `HELIX_TAPE_ROW_HEIGHT` 42px, overscan 8 | `—` per formatter |
| **LIVE / STALE badge** | age of newest **real** print | `Date.now() − max(flowEventTimeMs)`; STALE > **5 min**; 10s re-render ticker so a quiet tape ages honestly | `—` when no row carries a real time |
| **Net Premium Leaderboard** | top **10** by call+put premium, `call_pct` bar | `netPremiumLeaders` | `call_pct` **null**, not 50, when both legs are 0 |
| **Expiry Concentration** | 0DTE / This week / Monthly / LEAPS, call/put split | `expiryHorizonLabel`: ≤0 / ≤7 / ≤30 / >30 days | panel applies a **$50k render floor**; Largo's copy deliberately does not |
| **Route Breakdown** | SWEEP / BLOCK / SPLIT / CROSS / FLOOR / MULTI / OTHER, premium + share | `executionRouteKey(alert_rule)` — **substring match on the UW rule string** | `pct` **null** on a zero denominator |
| **Strike Stack Detector** | contracts printing repeatedly (same strike+expiry+side) | `computeFlowStrikeStacks`, `minAlerts: 2`, window `HELIX_STRIKE_HITS_WINDOW_MIN` = **15 min** | |
| **Velocity Radar** | prints/15min vs prior 15min, per ticker | `detectVelocitySpikes` — ≥**2** recent AND ratio ≥**3** | rows with no `event_at` are skipped entirely |
| **Split Flow Radar** | opposing call+put ≥**$500k each leg** within **30 min** | `detectSplitFlow`; direction bull ≥60 / bear ≤40 / else mixed | |
| **High Score Prints** | top prints by conviction | `selectTopPrints`, limit **12** | carries `mode` + `sessionFallback` |
| **Cumulative Net Premium** | running call−put | client-accumulated samples, recharts (lazy) | needs ≥2 samples |
| **Sector Flow** | per-sector premium | `getSector` map | market-wide only |
| **Dark Pool** | dark-pool prints | live UW dark-pool fetch (`fetchDarkPoolPrints`) — **not** the flow tape | |
| **Night Hawk Flow** | 0DTE plays cross-referenced to tape | `NightHawkEdition` join | cross-product |
| **Signal Outcome Tracker** | follow-through rate | `/api/market/helix/signal-outcomes` → `summarizeHelixSignalOutcomes` | `winRatePct` **null** below **10** graded rows |
| **Flow Brief** (native shell) | deterministic memo | `composeFlowBrief` — no LLM | |

---

## 8. Field inventory — the Largo boundary

Four tools. All four read the tape through **one** fetch builder (`helixTapeFetchOptions`) and share
**one** contract module (`helix-contract.ts`) so they cannot drift into disagreeing about whether the
same tape is stale, or about whether SPXW is SPX.

### Contract fields (`helix-contract.ts`)

| Contract point | Implementation | The rule |
|---|---|---|
| C2 freshness | `tapeFreshness(newestAgeMinutes)` | `live` <60s, `delayed` <300s, `stale` ≥300s. **Both fields null when age is unmeasurable** — common, not exceptional. 300s is the desk's own STALE flip, so Largo can never call a tape fresh that the member's screen calls stale |
| C3 absence | `unavailable(reason, what_is_missing, retryable)` | used **only** on a genuine failure. A quiet tape stays `available: true` + `empty_reason: "no_prints_in_window"` |
| C4 identity | `helixTickerIdentity` | returns `ticker` **unchanged** + `canonical_root` + `weekly_variant`. SPX and SPXW are different settlement series that both trade (measured 2026-08-20: SPX 350 prints, SPXW 9, same window) — join on the root, never restate SPXW as SPX |
| C5 direction | `tapeDirection(callPct)` | bull ≥55, bear ≤45 (the panel's own thresholds). **null, never "neutral", when `callPct` is null** — neutral is a measurement; the key is omitted entirely |
| C8 provenance | `HELIX_TAPE_PROVENANCE` | `{source: "internal_db", computed_by: "helix-tape-analytics"}` |

### `get_helix_tape_analytics` → `helixTapeAnalyticsForLargo` (product-reads.ts:1072)

`window` (coverage), `freshness`/`age_seconds`, `ordered_by: "recent"`, `premium_floor_applied: false`
+ `member_panel_premium_floor: 200000`, `session` (skew), `session_skew_baseline` (C10),
`direction` (only when measurable), `net_premium_leaders`, `route_breakdown`, `expiry_horizons`
(complete, never truncated), `expiry_concentration` (top **8 by premium**) +
`expiry_concentration_total_expiries` + `_truncated`, `as_of`/`session_date`, identity, provenance.

- `session.call_pct` is the **authoritative** session skew. `session.typeless_prints` is what
  reconciles `whale_prints` with `total_premium` — a typeless print is a print (and can be a whale)
  but adds to neither leg, so `{whale_prints: 1, total_premium: 0}` is coherent, not a broken sum.
- `expiry_horizons` exists because the per-date list drops near-dated rows: measured 2026-08-20 on a
  500-print tape, the true 0DTE bucket ($2.7M, 17 prints) ranked **16th** of 24 expiries and never
  reached the model, while the 4th-ranked row was 1DTE and 12× bigger.
- `session_skew_baseline`: trailing **22** sessions requested, prior sessions only, **≥10 measured**
  sessions required or `available:false / insufficient_history`; Tukey **1.5×IQR** fence for
  `unusual`. Null-`call_pct` sessions are **excluded**, never counted as 0 or 50.

### `get_helix_derived` → `helixDerivedForLargo` (product-reads.ts:867)

`stacked_hits` (cap 20), `top_prints` (12), `velocity_spikes` (12), `split_flow` (12) — each with
`_total` and `_truncated` via `cappedList`, because a display limit read as a count. Plus
`prints_analyzed`, `hits_window_min`, `top_prints_mode`, `top_prints_session_fallback`, `as_of`,
`session_date`.

### `get_helix_signal_outcomes` → `summarizeHelixSignalOutcomes`

Aggregate **and per-signal-type** distribution: `gradedCount`, `pendingCount`, `winCount`,
`winRatePct` (**null** under 10 graded), `continuedCount` / `flatCount` / `reversedCount` /
`otherCount`, `gradedOldestFiredAt` / `gradedNewestFiredAt`. Both time bounds exist because a rate
with no window reads as current when it is entirely yesterday's — measured 2026-08-21 09:40 ET, all
40 graded fires were from the prior afternoon.

### `get_helix_thermal_compare` — **SHARED SURFACE**

`src/lib/largo/helix-thermal-compare.ts` (577 lines) sits on the Helix/Thermal boundary. The thermal
side is **non-directional** by design (`neutral` for long gamma, `mixed` for short gamma);
`regime_interaction.read` carries the honest line. Coordinate with the Thermal lane before editing —
`CLAUDE.md`'s cross-PR ordering note records what an uncoordinated simultaneous edit costs.

### Intentional divergences between the desk and Largo — neither is an error

| | Desk `/flows` | Largo tools |
|---|---|---|
| Premium floor | hides < **$200k** | **no floor**, and says so (`premium_floor_applied: false`) |
| Consequence | reaches further back for the same row count | includes small prints the desk hides |
| So | a big name's total can be **lower** in the tool than on screen | small-print totals can be **higher** in the tool |
| Expiry render floor | **$50k** per bucket | none |
| Expired rows (`dte < 0`) | `daysToExpiry` clamps to 0; `dte === 0` bucket → **"This week"** ⚠️ | `expiryHorizonLabel` uses `dte <= 0` → **"0DTE"** |

The last row is a **known, logged** divergence: the panel files an expired contract under a future
horizon. Deliberately not fixed inside the Largo change that found it (member-facing render change,
outside that blast radius). It is still open — §9.5.

---

## 9. Trace — one signal, function by function

`velocity_spike` and `split_flow`, the only two HELIX signals with a persisted outcome ledger.

```
INPUTS      fetchRecentFlows({ since_hours: 1, order: "recent", limit: 5000 })   db.ts:2559
              → last hour of flow_alerts, newest first, NO min_premium (ingest floor already applied)

FEATURES    detectVelocitySpikes(flows, nowMs)        helix-signal-detection.ts:41
              per ticker: recent = prints with age ≤ 15min; prior = prints 15–30min old
              ⚠ requires alert.event_at — ingest-stamped rows (majority of tape, §3) are SKIPPED
            detectSplitFlow(flows, nowMs)             helix-signal-detection.ts:80
              per ticker: call premium + put premium within 30min, via flowEventTimeMs

CONDITIONS  velocity: recent ≥ 2  AND  recent / max(1, prior) ≥ 3
            split:    callPrem ≥ $500k  AND  putPrem ≥ $500k

SCORE       velocity: ratio (sort key only — no 0-100 score)
            split:    callPct = call/(call+put) × 100

CONFIDENCE  NONE. Neither signal emits a calibrated confidence, and none is invented.
            (Contract C6: omission is honest. The ledger's follow-through rate in §8 is the
             closest thing to a calibration and it is a POPULATION rate, not a per-firing one.)

GATES       none at fire time. Dedup is the only gate: window_start bucket
              velocity → floor(now / 15min)   ← matches the detector's own recent window
              split    → floor(now / 30min)   ← matches the split window
            so a signal re-detected in the same bucket across cron runs is the SAME firing.

DECISION    recordHelixSignalFirings()                helix-signal-outcomes-job.ts:31
              row = { signal_type, ticker, window_start, direction, context, price_at_fire }
              direction: velocity → NULL (magnitude signal, not directional)
                         split    → bullish (callPct≥60) / bearish (≤40) / mixed
              price_at_fire ← the firing print's OWN underlying_price (newest row per ticker).
              No external call at record time — by design.

STATE       CHECKPOINTS = price_5m (+5m), price_15m (+15m), price_1h (+1h)
            gradeHelixSignalOutcomes()                helix-signal-outcomes-job.ts:120
              for each checkpoint whose minAge has elapsed, fetch price via priceNearMs():
                flowPriceSymbol(ticker) → index vs equity namespace  ← index roots (SPX/SPXW/NDX/
                RUT/VIX) return HTTP 200 + ZERO results from the equity aggregates endpoint, so
                every index signal graded "price unknown" forever until this resolver landed
                (FINDINGS 2026-08-19)
                → fetchIndexMinuteBars | fetchStockMinuteBars, ±5min around the target
                → closest bar to targetMs (not first/last — the market may be closed part of it)
              price == null → row stays PENDING, retried next run. Never fabricated.

OUTCOME     gradeOutcome(direction, priceAtFire, price1h)   helix-signal-outcomes-job.ts:106
              |change| < 0.1%            → "flat"
              direction bullish          → change > 0 ? continued : reversed
              direction bearish          → change < 0 ? continued : reversed
              direction null (velocity)  → "continued" if it moved at all — grading ACTIVITY,
                                            not a directional call the signal never made

SURFACED    GET /api/market/helix/signal-outcomes → SignalOutcomeTracker + get_helix_signal_outcomes
            winRatePct is null below 10 graded rows. continued/flat/reversed reported separately
            because "62.5% win rate" implied 37.5% went wrong when only 7.5% actually reversed and
            30% stalled — a signal that stalls is a different instrument from one that is wrong.
```

**Cadence:** `helix-signal-outcomes` cron, `~Every 15 min (market hours)`, weekdays only,
`stale_after_min: 45`, guarded by `pg_try_advisory_lock("helix-signal-outcomes")`.

**The one place client and server could still disagree:** both call the *same* detection functions,
which is the point of `helix-signal-detection.ts` — but they call them over **different
populations**. The client runs them over `displayAlerts` (its filtered, $200k-floored, possibly
ticker-scoped buffer); the cron runs them over the unfiltered last hour. So a badge and a ledger row
can legitimately differ, and nothing currently records which population produced a firing. Recorded
as an open question (§9.6), not a defect — the shared *definition* is what the extraction guarantees.

---

## 10. How we know it is correct — the verification inventory

**Unit tests present** (`npx tsx --test`, Node 20):
`helix-flow-format`, `helix-table-columns`, `helix-signal-detection`, `helix-signal-outcome-summary`,
`helix-skew-baseline`, `helix-strike-leaders`, `helix-top-prints`, `helix-print-detail`,
`helix-analytics-scope`, `helix-flow-filter-backfill`, `helix-flow-tape-merge`, `helix-flow-ios`,
`contract-drilldown-parse`, `occ-contract-id`, `HelixCommandBar`, `HighScorePrints`,
`ExpiryConcentration`, `recharts-grid-axis-binding`, plus Largo-side `helix-contract`,
`helix-tape-analytics`, `helix-thermal-compare`.

**Cross-cutting ratchets that cover HELIX:** `src/lib/largo/contract/session-anchor.test.ts` (C1),
`src/findings-hygiene.test.ts`, `src/lib/cron-registry.test.ts` (route↔registry drift).

**Harnesses that can see HELIX:**
- **`scripts/audit/helix-tape-inventory.mjs` — NEW, committed with this map.** The first harness
  HELIX has ever had. Read-only against prod, one temp Clerk user deleted in a `finally`, imports
  the REAL `executionRouteKey` rather than reimplementing it. Reports writer split, per-group field
  presence, signal eligibility, route buckets, `alert_rule` distribution, IV unit verdict, implied
  contract counts and tape shape. Every `MEASURED 2026-08-22` number in this map is one run of it.
  Pure helpers in `lib/helix-tape-inventory-eval.mjs`, 12 unit tests (`npx tsx --test`, Node 20).
- `scripts/audit/largo-truncation-probe.mjs` — asks the LIVE agent whether each tool's payload
  actually arrived. **Not yet run against all four HELIX tools in this pass** (Phase 1 queue).
- `scripts/audit/data-validator.mjs` — cross-provider ground truth; auth block reusable.
- `proxy-browser.cjs` + the `meridian-interaction-audit.mjs` pattern — pixel measurement.

**Verification gaps — no harness can currently see these:**

| Gap | Why it matters |
|---|---|
| No live UW-vs-tape reconciliation | nothing checks that a print UW emitted actually landed in `flow_alerts` — a missing print is invisible by construction. Now sharper: §4A shows one whole producer bypasses the UW REST path entirely, so "reconcile against UW" would not even cover 70% of rows |
| No `/flows` UI harness | there is no HELIX equivalent of `meridian-interaction-audit.mjs`. Every `/flows` claim rests on selector-free reasoning about the code |
| `ask_pct` SQL ↔ SSE parity untested | the two derivations must agree; nothing asserts it |
| Signal ledger not reconciled against the badges | §9.6 |
| No admin HELIX dashboard | `admin-helix-health.ts` notes there is no `admin-spx-dashboard.ts` equivalent for HELIX |

---

## 11. UNKNOWNs and candidate findings

Ranked by IMPACT × FREQUENCY × CONFIDENCE-IN-FIX × IMPLEMENTATION-RISK, per the charter. **None of
these has a fix PR yet — the Phase 0 gate is that this map merges first.** They are recorded here
with their evidence so the next pass starts from a position, not from scratch.

**9.0 — SPX and SPY cannot fire either HELIX signal, while carrying 92% of the tape's premium.**
The lane's highest-impact structural finding, and it only became visible by measuring the live
population (§4A). Both persisted signals require a real print time; the Group B feed has none; Group
B is SPX and SPY. So the two names that top every premium panel are **structurally incapable** of
producing a velocity spike or a split-flow signal, and `MEASURED 2026-08-22` only **30% of the tape
(1500/5000 rows) is signal-eligible at all**. Neither detector is buggy — each correctly refuses to
date an undatable print. The defect is that **nothing states it**: not the panels, not the ledger,
not `get_helix_derived`, whose `velocity_spikes` / `split_flow` arrays report a total and a
truncation flag but never the eligible denominator they were computed over. A member or a model
reading "no velocity spikes on SPX" concludes the tape was quiet, when SPX was never eligible.
Minimum honest fix: carry the eligible-vs-total denominator into the payload and the panel
(`signalEligibility()` in `lib/helix-tape-inventory-eval.mjs` already computes it). The deeper
question — whether Group B should be given a print time at all — is upstream of this lane and needs
the coordinator.

**9.1 — `helix-discord-digest` is unreachable in production.** The route is complete (filters
≥$500k · fill <$10 · ≤30 DTE, Redis NX dedup, two embed builders), `railway.helix-discord-digest.toml`
exists as a schedule *catalog* entry, but the job is in `INTENTIONALLY_UNREGISTERED` ("Unscheduled in
cron-jobs.json") and **no code in `src/` invokes it** — unlike `darkpool-discord`, which the same
comment says is "invoked off another job's path". Per-print HELIX Discord alerts *do* fire
(`notifyHelixDiscordFlow` from `flow-persist`), so the channel is alive; only the digest is dormant.
Needs a decision, not a patch: schedule it, or delete it and drop the catalog file. `UNVERIFIED-LIVE`
— the blackout-infra `cron-jobs.json` was not read this pass.

**9.2 — Two UTC-anchored DTE derivations at ingest (C1 class).** `parseUwFlowAlert`
(`unusual-whales.ts:270`) computes `dte` from `new Date(expiry) − Date.now()` in UTC and derives
`route` from it; `dteFromExpiry` (`flow-persist.ts:42`) does the same for the premium-floor decision.
Between **20:00 and 24:00 ET** the UTC date is already tomorrow, so a next-session expiry evaluates
as 0DTE. Consequences: (a) SSE rows carry `route: "0dte"` for a 1DTE contract — surfaced by
`TickerDrawer.tsx:41`'s badge; (b) the ingest score adds its **+15 0DTE bonus** to that print, and the
score is **persisted**, so it outlives the window and shows in the Score column and its sort;
(c) the print gets the lower $50k persistence floor. **Assessed impact: low** — US options do not
trade 20:00–24:00 ET, so the window is nearly empty of live prints. Worth fixing for correctness and
because it is exactly the class the C1 ratchet exists to catch, but it is not an incident. The REST
read path is unaffected (its `dte`/`route` are ET-anchored in SQL).

**9.3 — `gex_proximity` absence was ambiguous — FIXED.** The field was omitted in three situations
the payload could not distinguish: the strike genuinely is not near a level; the GEX lookup timed
out (300ms) or the cache was cold; or the ticker fell beyond the 100-name enrichment cap on a wide
page. On the tape all three render as *no badge*, and they reached Largo identically through
`get_ecosystem_context`'s `flow_full_state`.

`MEASURED 2026-08-22`: the tape spans **273 distinct tickers**, so **173 were past the cap and never
evaluated at all**; `gex_proximity` was present on just **2.2%** of rows (3.9% Group A, 1.5% Group
B). The dominant reason for absence is therefore *not* "not near a level" — it is **"never
checked"**, which is the reading the payload could not express.

**FIXED:** every enriched row now carries **`gex_evaluated: boolean`**, set explicitly on both
branches — `true` whenever real levels were in hand and the comparison was made (including when the
answer is "not near anything", which is a known state), `false` when the print was never looked up.
`tool-defs.ts` teaches Largo to read it before drawing anything from an absent label. The cap
decision moved into the pure `tickersToEvaluate()` in `flow-gex-proximity.ts` — `flow-gex-enrichment.ts`
reaches `server-only`, so nothing in it could be unit-tested, which is exactly how a cap this
consequential went unmeasured. 9 tests cover the split, the cap boundary, blank tickers, and that
"checked, not near" is never encoded as absence.

**9.4 — `implied_volatility` units — RESOLVED and FIXED, and my first reading of the tail was
wrong.** `fmtIv` branched on `iv < 3` to decide fraction-vs-percent **per row**, which is only safe
if the feed is genuinely mixed-unit. It is not. `MEASURED 2026-08-22` over 3500 rows carrying IV:
**min 0.07, p25 0.13, median 0.17, p75 0.23, max 106.2** — a single fractional mode, no second
cluster in the tens. The feed is **uniformly fractional**.

**CORRECTION to this entry's first version.** It described the 148 rows (4.2%) above the branch as
*"a 3.5 — 350% IV, ordinary for a near-dated contract"*. That was a guess and it was wrong.
Measured directly: **every one of those rows is SPY, expiry 2026-08-21, `dte: -1`** — EXPIRED,
deep-in-the-money calls (365C / 400C / 500C against a ~640 spot), mean DTE **3d** against the body's
**146d**. An expiring deep-ITM option is almost entirely intrinsic, so the provider's IV solve is
degenerate and returns noise. These are not high-IV contracts; they are non-measurements.

That changes what "correct" means here, and it is why the old branch was worse than either honest
alternative: it rendered `106.2` as **"106%"** — a plausible IV a member has no reason to distrust —
where the feed's real unit reads `10620%`, which is self-evidently not a measurement.

**FIXED** (`fmtIv` renders the fraction uniformly; 20 tests pin the unit at every magnitude and pin
the degenerate values as obviously-wrong rather than plausible). Two facts from §4A remain: IV is
present **only** on Group B, so the IV column is blank for every equity name and populated only for
SPX/SPY; and no row was below 0.03, so the feared "genuinely sub-3% IV multiplied by 100" case does
not occur on this tape.

**STILL OPEN, and it is a product question not a formatter one:** whether to suppress IV entirely
where the solve is degenerate. It needs a threshold nobody has justified — real 0DTE contracts do
trade at several hundred percent — and it overlaps §9.5, since every degenerate row is an expired
contract the panel is also mis-bucketing. Raised for the coordinator rather than decided by a magic
number.

**9.5 — The Expiry Concentration panel files expired contracts under "This week".** The panel reads
`a.dte ?? daysToExpiry(a.expiry)` and its `bucketLabel` tests `dte === 0` exactly. The SQL `dte` is
genuinely negative for an already-expired print, so it misses the `=== 0` branch and lands in
`dte <= 7` — "This week", a future horizon, for a contract that has expired. (The `daysToExpiry`
fallback clamps to 0 and would bucket it correctly, so the defect only shows on the normal path where
the API supplied `dte` — which is every row.) Largo's copy (`expiryHorizonLabel`) already uses `dte <= 0`
and buckets them as 0DTE. Known and logged when the Largo side was fixed; the member-facing half is
still open. `MEASURED 2026-08-22`: **803 of 5000 rows (16.1%) carry a negative `dte`** — this is not
a rare edge, it is a sixth of the tape being filed under a future horizon. Small, contained,
member-visible, and now quantified.

**9.6 — Nothing records which population fired a persisted signal.** Client badges run the detectors
over the filtered/floored/scoped client buffer; the cron runs them over the unfiltered last hour.
Same definition, different inputs — so ledger and badge can legitimately disagree, and today neither
the row nor the panel says so. Cheap fix (stamp the population into `context`), and it is the
precondition for ever using the ledger's follow-through rate to describe what a member *saw*.

**9.7 — The conviction score saturates at $1M.** `min(60, premium/$1M × 60)` means every print at or
above $1M contributes the same 60 premium points, so a $50M block and a $1.1M print are separated
only by the sweep (+25) and 0DTE (+15) flags. Whether that is intended compression or an accident is
**UNKNOWN** — the score predates this lane's records and no design note explains the shape. Do not
retune it on intuition: the ledger in §9 is the only instrument that could say whether score
correlates with follow-through, and that measurement has not been run.

**9.8 — the Route Breakdown panel is 98.8% "OTHER" — RESOLVED, and it is the most broken thing
found this pass.** `executionRouteKey` matches `alert_rule` against
`["SWEEP","BLOCK","SPLIT","CROSS","FLOOR","MULTI"]` by `String.includes`, first hit wins.
`MEASURED 2026-08-22`:

| bucket | rows | share |
|---|---|---|
| **OTHER** | 4939 | **98.8%** |
| FLOOR | 58 | 1.2% |
| SWEEP | 3 | 0.1% |
| BLOCK · SPLIT · CROSS · MULTI | **0** | **never fire at all** |

A panel titled "Route Breakdown" that renders one bar reading OTHER is not a breakdown. Two
independent causes, both fixable:

1. **70% of rows carry no `alert_rule`** — the entire Group B feed (§4A) has no rule field, and
   every one of those rows is bucketed `OTHER`.
2. **The dominant real rule family matches none of the six keys.** `RepeatedHits` (19.2%),
   `RepeatedHitsAscendingFill` (5.6%) and `RepeatedHitsDescendingFill` (3.9%) — **28.7% of the
   tape** — all fall to `OTHER`. And `ruleLabel()`, **in the same file**, already maps `"repeated"`
   to a `REPEAT` badge shown on the tape. So HELIX has two functions parsing one field with
   different vocabularies, and the panel uses the one that does not know the most common value.

The nine distinct `alert_rule` values live are: `RepeatedHits`, `RepeatedHitsAscendingFill`,
`RepeatedHitsDescendingFill`, `FloorTradeLargeCap`, `LowHistoricVolumeFloor`, `FloorTradeMidCap`,
`SweepsFollowedByFloor`, `FloorTradeSmallCap`, and absent. The multi-match ambiguity is real but
tiny: **3 rows** of `SweepsFollowedByFloor` match SWEEP+FLOOR and are filed as SWEEP by list order.
Fixing the vocabulary matters; fixing the precedence barely does.

Blast radius: the member panel **and** Largo's `route_breakdown` field, which is currently telling
the model that 98.8% of institutional flow has an unknown execution route.

**9.9 — Style inconsistency, not (currently) a defect.** `detectVelocitySpikes` reads
`alert.event_at` directly while `detectSplitFlow` uses `flowEventTimeMs`. For rows produced by the
current REST and SSE paths the two agree, because a row with no `event_at` is always
`tape_time_estimated` and `flowEventTimeMs` returns null for it too. It is one shape change away from
diverging, and the two detectors sit in the same file for the express purpose of not drifting.

---

## 12. Phase 1 queue (what this map says to do next)

Reordered after the live measurement — three items moved up because they are no longer hypotheses,
and one moved down because it was answered.

1. **Take §9.0 to the coordinator first.** It is the only finding here whose fix may not belong to
   this lane: giving Group B a print time is an upstream/ingest decision. The in-lane half (carry
   the eligible denominator into payload + panel) is a normal small PR and can land regardless.
2. **§9.8 — the Route Breakdown vocabulary.** Highest member-visible impact per unit of risk: teach
   `executionRouteKey` the `RepeatedHits*` family (reusing `ruleLabel`'s existing vocabulary rather
   than inventing a second one), and decide explicitly what a rule-less Group B row should bucket as
   — `OTHER` is defensible, but only once it stops meaning four different things.
3. **§9.4 — pin the IV unit** and delete the `iv < 3` guess. Add a unit test with the measured
   distribution so a future feed change fails loudly instead of silently rescaling 4.2% of rows.
4. **§9.3 — `gex_evaluated` companion flag.** Now known to matter for 173 of 273 tickers.
5. **§9.5 — the expired-contract bucket** (16.1% of the tape). Small and contained.
6. Run `scripts/audit/largo-truncation-probe.mjs` against all four HELIX tools **with a control**;
   report every `COMPLETE` as UNVERIFIED if the control does not come back TRUNCATED.
7. Build the `/flows` interaction harness on the `meridian-interaction-audit.mjs` pattern, gated on
   a PAGE-LOADED proof. `helix-tape-inventory.mjs` covers the DATA; nothing yet covers the PIXELS.
8. **Re-run `helix-tape-inventory.mjs` during RTH.** Everything above was measured on a settled
   weekend tape. The ratios that will move: signal eligibility, the A/B row mix, `gex_proximity`
   presence (a warm cache should raise it), and the real-print span. If the writer split does *not*
   hold during RTH, that is a bigger finding than anything in §11.
9. §9.6, §9.7, §9.1 as the coordinator directs — §9.7 (score saturation) explicitly needs the
   ledger measurement before anyone touches a threshold.
