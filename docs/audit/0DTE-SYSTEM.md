# The 0DTE System — Full Technical Reference & QA Audit

_Last compiled: 2026-07-24. Source of truth is the code; this document cites `file:line` so it can be
re-verified. Written from a 7-agent parallel audit (4 code-QA reviewers + 3 data-provenance reviewers)
plus a live provider-probe pass._

---

## 0. Executive summary

The 0DTE system is a **flow-driven, same-day options engine** that discovers candidates from live
options-flow across the **entire market** (not an index-only or a fixed universe), gates them through a
stack of evidence + hard-safety gates, tracks committed plays live to the ~second, and grades every
outcome against real minute bars so its own edges must **graduate on evidence before they gate**.

**Is the data real?** Yes — with two provenance caveats worth knowing. Every member-facing number traces
to a real provider field (Polygon/Massive, Unusual Whales, Benzinga) or to a documented derivation from
provider fields. Live provider probes on 2026-07-24 confirmed the option greeks, IV, OI, spot, index
levels, minute bars, flow premium, and news schema are all genuinely returned by the APIs. No member-facing
fabrication was found in the priced-data seams. The caveats: (a) a subset of "positioning" metrics (VEX /
vanna / charm, GEX, walls, flip, max-pain) are **model-derived** from provider greeks+OI, not raw provider
fields — correct, but derived; (b) one real field-mapping bug drops the **index-option** underlying spot
(reads `.price`, Polygon sends `.value` for index OCCs) — it degrades to `null`, never a wrong number.

**Is it all WebSockets?** Server-side, yes; browser-side, no — and that's by design. The agent proxy blocks
WS upgrades to browsers. UW/Polygon **WebSockets run server-side on ECS**, land in an in-memory + Redis
cache, and the browser receives the data over **SSE (`/stream`, ~1s) + SWR REST polling (5s board / 30s
horizons)**. The chain is intact end-to-end for marks/P&L/greeks and for the board.

**Do we have flaws?** Yes — none catastrophic, several real. The audit found a cluster of **HIGH-severity**
issues concentrated in the live-marks display seam and the board→UI wiring (stale marks shown as live; an
open position that can vanish from the deck; a degraded board that renders as a calm empty tape). Two of the
HIGHs (stale-overlay + greeks-null) are **already fixed** (PR #1020). The rest are catalogued in §9 with
severity, `file:line`, failure scenario, and fix.

---

## 1. What "0DTE" means here & the candidate universe

"0DTE" = an options play on a contract expiring **today or tomorrow** (`max_dte: 1`). The candidate
universe is **demand-driven by options flow**, not a hardcoded list:

- The scanner pulls the **top ~400 options-flow prints market-wide** from Unusual Whales, scoped to 0–1 DTE
  prints ≥ **$150k** premium in the last **7 hours** (`scan.ts:161`). `max_dte:1` is load-bearing — without
  it, multi-week whale prints crowd out every same-day print (live-repro: a $3.1M AAPL multi-week stack →
  0 setups).
- **No allowlist.** Any ticker printing significant same-day flow is eligible — indices (SPY/SPX/QQQ) show
  up because they always carry huge 0DTE flow, but so do NVDA/TSLA/AAPL/HOOD/etc. whenever they print.
  Today's live board: AAPL / HUT / GS, not indices.
- **Excluded** (`scan.ts:100,187`): leveraged ETPs, VIX, UVXY, and any ticker already in the current Night
  Hawk evening edition (dedupe — a repeat, not a find).
- It is **not** a brute-force scan of all ~8,000 stocks. That true whole-market sweep is a **separate**
  engine — the banger scanner (§5.2) — which screens ~12.4k names/day for momentum breakouts and suggests
  cheap OTM weeklies, a different lane from the 0DTE flow board.

---

## 2. Data sources & provenance (the API layer)

### 2.1 Providers

| Provider | Auth | What it supplies |
|---|---|---|
| **Polygon / Massive** | `apiKey` query param; base `POLYGON_API_BASE` (defaults `https://api.massive.com`) | Stock/index snapshots, option chain (greeks/IV/OI), unified per-OCC snapshot, minute bars, options reference, technicals (EMA/RSI/SMA), **and Benzinga news** (rides the same key at `/benzinga/v2/news`) |
| **Unusual Whales** | `Bearer` + `UW-CLIENT-API-ID` | Options flow alerts, dark-pool, market-tide, net-flow, GEX-by-strike, NOPE, IV-rank, max-pain, next-earnings |
| **Benzinga** | (rides Polygon key) | News/catalysts headlines by channel/ticker |

### 2.2 Provenance table (member-facing category → provider field → verdict)

`SOURCED` = provider returns it directly (confirmed by live probe); `DERIVED` = we compute it from provider
fields (formula cited); all live probes 2026-07-24.

| Category | Origin | Verdict |
|---|---|---|
| Stock spot price | Polygon `lastTrade.p ?? day.c` | **SOURCED** (SPY 738.18 live) |
| SPX / index level | Polygon indices `results[].value` | **SOURCED** (I:SPX 7408.3 ≈ 10× SPY ✓) |
| VIX | Polygon `/v3/snapshot/indices` I:VIX `.value` | **SOURCED** (18.7 live) |
| Day HOD/LOD/VWAP/vol | Polygon `day.{h,l,vw,v}` | **SOURCED** |
| Option greeks Δ Γ Θ V | Polygon chain `greeks.{…}` | **SOURCED** (7400C: δ0.543 γ0.0046 θ−18.7 ν1.49) |
| IV | Polygon `implied_volatility` | **SOURCED** (unit varies — see §9-P) |
| Open interest | Polygon `open_interest` | **SOURCED** (7400P oi 4828) |
| Flow premium | UW `total_premium` | **SOURCED** (SPXW put 542,900) |
| Flow side/strike/expiry | UW `type/strike/expiry` | **SOURCED** |
| Minute bars OHLC | Polygon aggs `results[].{o,h,l,c,t}` | **SOURCED** |
| News / catalysts | Benzinga `title/published/channels/tickers` | **SOURCED** (RHI guidance headline live) |
| **GEX / net $-gamma** | `sign·γ·oi·shares·spot²·0.01` | **DERIVED** from provider γ+oi |
| **Gamma flip** | cumulative Σγ zero-crossing (interp.) | **DERIVED** |
| **Call/Put walls, king node** | argmax of net-γ by strike | **DERIVED** |
| **VEX / vanna / charm** | **local Black-Scholes** (normPdf, d1/d2) × oi × spot | **DERIVED — greeks NOT from provider** |
| **DEX / dealer $-delta** | `−(δ·oi·shares·spot)` | **DERIVED** from provider δ |
| **Max pain** | OI-weighted pain minimizer | **DERIVED** |
| **Flow `score` / `route` / `direction`** | synthesized (UW returns **no** score) | **DERIVED** |
| TICK / ADD / TRIN internals | breadth proxies when index feed absent | **DERIVED PROXY — badged `estimated`** |

**Bottom line:** every derived metric traces to real provider inputs; the codebase is disciplined about
returning `null` rather than defaulting (flow side → `UNKNOWN`, spot → `null`, no-OI → skip). The one true
mapping defect is the index-option underlying (§9-P1).

---

## 3. Live transport chain (WS → server → browser)

**No browser opens a WebSocket** — verified: zero `new WebSocket` under `src/features|components|hooks|app`;
every socket lives in `src/lib/ws/*` (`runtime="nodejs"`, server-side). Browsers use **EventSource SSE + SWR
REST**.

### 3.1 Server-side ingestion (`ensureDataSockets()`, called at the top of every Night Hawk route)

| Socket | Channels | Lands in |
|---|---|---|
| `polygon-socket` | indices A/AM aggs: `I:SPX,I:VIX,I:VIX9D/3M,I:TICK,I:TRIN,I:ADD` | `indexStore` + Redis (leader-elected) |
| `uw-socket` | `flow_alerts, interval_flow, net_flow, gex_strike_expiry, price` | in-mem stores → Redis `uw_cache:*` → DB → pub/sub fanout |
| `options-socket` | `Q./T.` per active 0DTE OCC | `optionMarks` map + Redis (env-gated `OPTIONS_WS_ENABLED`) |
| `stocks-socket` | LULD halts | halts store |

### 3.2 Delivery lanes → the browser

| Live field(s) | Delivery + cadence | Consumer |
|---|---|---|
| setups, ledger P&L, allocation, governor | REST `GET /api/market/zerodte/board`, **SWR 5s** (5s server cache) | `ZeroDteDeck` |
| mark, live_pnl_pct, greeks, status | **SSE `/api/market/zerodte/marks/stream`, 1s** (15s heartbeat, backpressure, `MAX_STREAMS=2000`) | `useZeroDteLiveMarks` → `overlayLiveMarks` |
| marks REST fallback | `GET /api/market/zerodte/marks`, 2.5s | (rich hook only) |
| Swing / LEAPS lanes | REST `/api/market/nighthawk/horizons`, **SWR 30s** | `HorizonDeck` — **no data lane behind it yet (§9)** |
| Legacy edition | evening cron | `LegacyDeck` |

**Server mark poller** (`ensureZeroDteMarkPoller`): 1s interval, RTH-gated, WS-first (2.5s fresh window) then
one batched unified snapshot for misses (≤16 OCCs). Runs on whichever replica serves the stream, so the
chain is self-healing even if the options WS is off (marks fall to REST fill-in).

**Chain confirmed intact** for marks/P&L/greeks/status and setups/ledger P&L. The gaps are on the client
edge (§9), not the server.

---

## 4. The discovery + gating funnel

```
UW flow (top-400, 0-1DTE, ≥$150k, 7h)  ─┐
UW multi-day flow (5d, all-expiry)      ─┼─►  deriveZeroDteSetups  ─►  evidence gates  ─►  score (0-100)
Night Hawk edition (dedupe)             ─┘        (per-ticker agg)       (4 real + 2 struct)   sort, top-10
                                                                                                    │
        enrichment (top-5 dossier) · contract plans (−50/+100) · intraday edge (top-5) · confluence │
                                                                                                    ▼
                    hard-gate stack (G-1…G-11 + governor + Cortex)  ─►  commit-vs-watch  ─►  ledger
```

### 4.1 Per-ticker aggregation (`deriveZeroDteSetups`, `board.ts:333`)
Rows filtered (excluded tickers; `dte==null|>1|<0`; prior-session expiries) then aggregated per ticker:
raw + **aggression-weighted** call/put premium, prints, per-`strike|expiry|side` sub-aggregates,
freshest-print underlying, spike stamps. `aggressionWeight(askPct)`: `≥60→1, ≥45→0.6, else 0.15`,
**null→0.5** (see §9-1).

### 4.2 Evidence gates (`board.ts:475`), in order
1. **min_gross** — `gross < $750k` → reject
2. **min_aggr_share** — `aggrWeighted/gross < 0.3` → reject
3. **min_dominance** — winning-side `aggrShare < 0.65` → reject (direction = `callAggr≥putAggr ? long : short`)
4. **no_dominant_strike** — structural guard
5. **no_underlying_price** — fail-**closed** (was fail-open; P0 fix)
6. **max_itm_pct** — `otmPct < −2%` rejects deep-ITM stock-replacement prints

Survivors get an evidence **score** 0-100 (premium tier + dominance + sweep% + prints + spike + aggression +
new-money), sorted, sliced to **10**.

### 4.3 Hard-gate stack (fresh finds only; committed tickers never re-gated)
G-1 tape alignment · G-2 opening window (10:00 ET unlock) · G-3 score floor (**65**) · G-4 VIX regime
(≥20 blocks non-index; ≥17 raises floor) · G-7 macro block · G-8/9 plan quality (no-quote / moved ≥35% /
illiquid >15% spread) · G-10 intraday conflict · G-11 halt/earnings · G-5 governor (session-stop ≥3,
concurrency ≤3, correlated-conflict, 20-min re-entry lock) · G-6 cross-system conflict (needs score ≥80).
Then the sequential **Cortex** layer can veto. Only true survivors enter `committedThisCycle`.

### 4.4 Commit-vs-watch (`persistZeroDteScan`, `scan.ts:497`)
Only the ~2-min `warmZeroDteBoard` cron persists (member polls never do). Reads today's ledger; a null read
returns 0 (fail-closed — fresh-vs-committed unknowable). **REFRESH** (ticker already in ledger) always
upserted with COALESCE pins keeping entry/plan immutable; **FRESH** must have `gate.verdict==="COMMIT"` and
a clean plan → committed, else → visible SKIP in `zerodte_scan_rejections`. `commit` is a one-way door;
`readZeroDteLedgerChecked` falls back to a last-good same-session snapshot so a transient DB blip never
demotes a committed OPEN back to a WATCH.

---

## 5. The engines

### 5.1 Engine A — flow-driven 0DTE (the board above)
Discovers from same-day flow, commits the gated survivors, tracks them live, exits via RATCHET (§6).

### 5.2 Engine B — whole-market banger scanner
Screens **every** US stock (Polygon grouped-daily, ~12.4k/day) for breakout/momentum movers (gain%, volume,
close-strength, price/liquidity filters), ranks by $-volume, suggests a cheap OTM weekly call. Exits via
mechanical **scale-out** (partial at 2× + trailing runner + hard stop) — the exit rule that converts
fleeting bangers into EV. Graded by `gradeBangerScaleOut` against forward option bars.

### 5.3 Iron-condor (premium-selling) geometry
`CONDOR_WINRATE_BY_WIDTH` (`iron-condor.ts:25`): `{0.4%→61, 0.6%→77, 0.8%→92, 1.0%→96, 1.5%→100}` (25-session
SPY/QQQ/IWM, 11:00 entry, close settlement). `selectIronCondor` places short strikes at the further of the
target width and just-beyond the dealer wall, wings beyond, rejects inversion / non-positive strikes.
**Evidence, not gating** — no EV claim without a live credit; the module documents the negative-skew tail
(shipped target-80 geometry = 98.7% WR / **18.7% intraday breach**). See §9-C2: the surfaced `est_win_rate`
can read `100`/`92` with no breach-rate companion.

---

## 6. The exit engine (`exit-engine.ts`, pure)

Two exit primitives, one evaluator:

- **RATCHET (0DTE, Engine A):** plan stop **−50%**, target **+100%**; ratchet arms at **+25% → floor 0
  (breakeven)**, locks at **+50% → floor +20%**, post-trim runner floor **+50%**; flat-timeout ≥25 min inside
  ±10%; thesis-break needs ≥2 opposing items past `max(entryCortexScore, 0.5)` or one veto.
- **SCALE_OUT (Swing/LEAPS/banger):** ⅓ @ +50 / ⅓ @ +100 / trailing runner.

Precedence: protective (higher of stop-mark vs ratchet-floor-mark) → thesis → target (TRIM then final) →
flat → hold. **Missing mark/entry ⇒ HOLD, never an exit** (fail-safe). `CLOSED` is sticky in SQL and `TRIM`
never regresses to OPEN/HOLD; peak/trough latch via `GREATEST/LEAST`.

**The ONE P&L derivation:** `pinnedLivePnlPct(entry, mark) = round(((mark−entry)/entry)·10000)/100`, guarded
`entry<=0||mark==null → null`. Used by the board, the SSE payload, and the exit engine — single source of
truth. Both `long` and `short` plays **buy premium** (a "short" play buys puts), so P&L sign is identical —
verified correct, not a bug.

---

## 7. Calibration & outcome grading (the honesty spine)

**Calibration-first:** every edge (confluence, flow-accumulation, gates, scale-out, condor) is attached and
persisted as **evidence only** — it never gates or sizes real risk until it **graduates** on graded outcomes.

- **Grading** (`gradePlanFromBars`, `plan.ts:183`): walks the contract's own minute bars, fixed rules
  (stop −50, target +100, time-stop 15:30 ET). Same-bar both-touch → **stopped** (conservative). No in-window
  bars → `ungradeable` (never coerced to a loss).
- **Look-ahead guard:** `fetchUngradedZeroDteRows` grades only `session_date < today` (live session excluded);
  banger grades gate on `expiry < today`. Both correct.
- **Graduation ladder** (`recommendGate`/`recommendSignal`/`recommendScaleOut`, `calibration.ts`): a gate
  earns `enforce` only at `n ≥ ENFORCE_MIN_BLOCK_N (10)` **and** delta `≥ 15` pts; else `keep_calibrating` or
  `insufficient_data`. Scale-out graduates on `meanReal − meanHold ≥ 0.15` at n ≥ 10.
- **Feature store:** base rates return `null` below `MIN_SAMPLES=20` (`sealRate`).
- **A+ tier** unlocks only at A-bucket `n ≥ 10 && WR ≥ 80%` — and is currently **hardcoded off** in the UI
  (`APLUS_UNLOCKED=false`), so it fails safe (never shows) but the graduation loop it advertises isn't wired
  (§9-C7).

**Honesty verdict (from the dedicated scan):** **PARTIALLY HOLDS → HOLDS after §9-H1/H2.** The priced-data
seams (marks, greeks, P&L, GEX positioning, gate/base-rate win rates) are rigorously null-honest. The one
genuine violation is a stale-regime read served as current in two consumers (§9-H1).

---

## 8. The Command Deck (UI)

Two-panel matrix terminal, one component for all four boards (0DTE / Swings / LEAPS / Legacy):
ranked plays left, a black/neon-green terminal right with **Thesis / Manage / PnL** tabs + an always-on
Δ Γ Θ V IV + MARK streaming strip that flashes on change. `ZeroDteDeck` polls the board (SWR 5s), merges
setups ⋈ ledger ⋈ allocation by ticker, maps via `terminalPlayFromZeroDte`, and overlays the ~1s SSE
live-marks lane (`overlayLiveMarks`). Cadence is honest: ~1s SSE + 5s board poll, event-pushed +
change-flashed — not literal per-millisecond (the browser can't hold a WS through the proxy).

---

## 9. QA FINDINGS (consolidated, ranked)

Legend: **[C]** CONFIRMED, **[P]** PLAUSIBLE. `✅ fixed` = already shipped.

### HIGH
- **9-1 [C] ✅ Stale SSE mark overlaid as LIVE** — `use-live-marks.ts` `overlayLiveMarks` ignored `row.stale`,
  replacing the fresher 5s board value with a >5s-old mark under a `● LIVE` badge; a dead lane froze its last
  frame. **Fixed in PR #1020** (skip stale rows + clear map on `CLOSED`).
- **9-2 [C] ✅ Greeks carry-forward defeated by an all-null object** — `markFromSnapshot` emitted an all-null
  greeks object (not `== null`), blanking the Δ Γ Θ V IV strip on every unpriced snapshot. **Fixed in PR #1020**
  (collapse all-null → `null`).
- **9-3 [C] Degraded/unknowable board renders as a calm "flat tape"** — the deck derives plays only from
  `resp.setups` and never reads `available/upstream_ok/degraded`; when the committed set is unknowable
  (`displaySetups=[]`) or the route returns `{available:false}` at HTTP 200, a member holding a live OPEN
  position sees zero rows + "no setup has cleared the floor" — a degraded board impersonating a healthy empty
  one. **Fix:** branch on `available===false || upstream_ok===false` → a distinct "board degraded" state.
- **9-4 [C] An open position can vanish from the deck** — the play list iterates **setups**, so a committed
  OPEN/HOLD/TRIM ledger row whose ticker ages out of the scan (score dropped, chase-gate now blocks a *new*
  entry) has no setup → never renders; the member can't see/manage their live position. **Fix:** seed the deck
  from the **union** of setups and OPEN/HOLD/TRIM ledger rows.
- **9-5 [C] Live deck wired to the weaker of two duplicate hooks** — `containers.tsx` imports the
  command-deck hook (no REST fallback, no staleness clock) while a richer
  `hooks/useZeroDteLiveMarks.ts` (2.5s REST fallback + staleness + `transport`) exists but is only wired to
  the now-dead `ZeroDteBoard`. On the SSE `503` cap or edge buffering, the deck silently degrades to the 5s
  board poll with no fallback. **Fix:** consolidate onto the rich hook (or port its REST fallback); delete the
  dead board. _(Partially mitigated by #1020's stale-skip; full consolidation is the follow-up.)_

### MEDIUM
- **9-H1 [C] Stale `market_regime` served as current** — `platform-intel-snapshot.ts` + `/api/platform/intel`
  read the latest `market_regime` row with **no trading-day freshness gate**, while the sibling
  `/api/market/regime` route already fixed exactly this (documented Fri→Sun 49h-stale incident). Feeds member
  sizing notes + the AI prompt a days-old regime over a weekend/holiday/cron outage. **Fix:** propagate the
  `captured_at != mostRecentTradingDay → stale/null` gate.
- **9-C1 [C] Scale-out realized multiple inflated by intrabar look-ahead** — `scale-out.ts` updates `peak`
  from the current bar's high **before** testing the trailing stop against the same bar's low; on **daily**
  bars (production) the ambiguous window is a whole day. Biases `recommendScaleOut` toward `enforce` and
  inflates the headline "realized-vs-hold" claim. **Fix:** compare the trail against the **prior** peak, update
  peak after.
- **9-C2 [C] Condor `est_win_rate` surfaces 92/96/100 with no breach companion** — a 25-session backtest can't
  support a literal 100% WR, and only close-settlement WR is exposed while the negative-skew product breaches
  ~1 session in 5 (18.7%). **Fix:** cap the label + add `est_breach_rate`/`skew:"negative"`.
- **9-6 [C] Board vs UI status labels** — gate-BLOCKED finds render as `WATCH` not `SKIP`
  (`containers.tsx:40`); a committed OPEN with aged-out gate context shows "✗ Hard gate" (`adapters.ts:105`);
  `market_aligned===null` renders a green "✓ Tape align / thesis intact" (`null !== false`). **Fix:** derive
  status/gate/thesis from persisted status + treat null-alignment as unknown, not pass.
- **9-7 [C] Top-5-only edge layer corrupts gating + calibration for ranks 6-10** — `attachIntradayEdge` runs
  only on the top 5, but all 10 are gated and confluence-logged, so ranks 6-10 gate on an un-adjusted score,
  G-10 can't fire, and they're always logged `weak` — biasing the confluence dataset. **Fix:** compute the
  intraday read for every gated setup (or gate only the enriched top-N).
- **9-8 [P] Cross-replica governor overshoot** — the concurrency/session-stop caps are enforced only in the
  pure pre-persist evaluation, not inside the upsert; two cron replicas can each commit past the cap. **Fix:**
  enforce the governor in the upsert transaction (conditional insert on a live-count/stop-count check).
- **9-9 [P] Exit engine can fire on a 5–30s-stale mark** via the `LATCH_MAX_MARK_AGE_MS=30000` fallback in
  `evalExit`; 0DTE premium moves 10–30%/min. **Fix:** gate the effective exit mark on the same 5s staleness the
  display promises.
- **9-C3 [C] Two disagreeing win definitions** — `isZeroDteWin = pnl>0` (record + calibration) vs the feature
  store's `doubled=win, time_stop=loss`; a green time-stop is a win in one and a loss in the other. **Fix:**
  rename the feature-store label to what it measures (`hitTarget`) or align to `pnl>0`.

### LOW (cleanups toward "a null is honest, a fabricated zero is a lie")
- **9-P1 [C] Index-option underlying dropped** — the unified snapshot reads `underlying_asset.price`; Polygon
  sends `.value` for index OCCs (SPX/SPXW/NDX/RUT/VIX) → `underlyingPrice` null for index-option valuation
  (contained: GEX/Vector resolves spot independently). **Fix:** `?? underlying_asset.value`.
- **9-H2 [P] Empty positioning fallback** emits `net_gex:0 / negative_gamma:false / source:"polygon"` with no
  `available` field — "no data" looks like "flat book." Guarded incidentally by null checks downstream. **Fix:**
  return `null`/`{available:false}`; make `negative_gamma` nullable.
- **9-5b/9-4-floats [C] Unrounded floats** — raw UW underlying + VIX interpolated into SKIP-card reason strings
  (`VIX 17.34000…01`) reach the member/ledger. **Fix:** round at aggregation + in reason strings.
- **9-C5 [P] Grader intrabar asymmetry** — committed grader includes the flag bar (`t < flag`), skip grader
  excludes it (`t+1`); a flag on a minute boundary can grade `doubled` on the flag bar. **Fix:** exclude the
  flag bar in both.
- **9-P/IV [C] IV unit inconsistency** — provider returns decimal (0.229) for live rows, `20`/`15.83`
  placeholders for expired/edge rows; stored verbatim. **Fix:** normalize/guard wherever IV renders as a %.
- **9-misc:** `net_premium` is aggression-weighted not raw (misleading name); `dte` (ticker-min) can disagree
  with `expiry` (top-strike); Night Hawk dedupe misses `SPX`↔`SPXW` root aliasing; SSE per-tick dedupe is dead
  code (`as_of` in every frame) — bandwidth waste, not a correctness bug; `markStore` never evicted; empty-sample
  analytics win rates return `0` not `null`; `OPTIONS_WS_ENABLED` likely unset in prod (marks ride the REST
  poller — still genuine ~1s, but the WS path is dead weight).

### Verified SOUND (checked, not defects)
Marks/P&L null-honesty; greeks OCC-keyed carry-forward; GEX positioning returns null on cold cache; base-rate
`MIN_SAMPLES`/`low_n` discipline; live-session & expiry look-ahead guards; MOVED-fill inflation blocked by G-8;
survivorship (ungradeable never imputed); conservative tie handling (same-bar → stopped, hard-stop before 2×);
allocation is advisory-only (never sizes); selection state stable across polls; both-direction P&L sign.

---

## 10. Priority remediation queue

1. **Fixed:** 9-1, 9-2 (PR #1020).
2. **Next HIGH batch (UI truth):** 9-3 degraded-state, 9-4 union-with-ledger, 9-6 status labels, 9-5 hook
   consolidation — all in the board→deck seam; one focused PR each.
3. **Honesty:** 9-H1 regime staleness, 9-H2 positioning fallback, 9-C2 condor breach-rate.
4. **Calibration integrity:** 9-C1 scale-out look-ahead, 9-7 top-5 edge coverage, 9-C3 win-def unification.
5. **Robustness:** 9-8 governor-in-transaction, 9-9 exit-mark staleness.
6. **Cleanups:** 9-P1 index underlying, float rounding, IV normalization, dedupe aliasing, store eviction.

_None of these block the system from operating; the HIGH cluster is about not showing a member a stale/absent
value as if it were live — the exact failure mode to eliminate for a real-money desk._
