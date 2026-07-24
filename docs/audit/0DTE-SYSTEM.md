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

**Do we have flaws?** We *did* — none catastrophic, several real: a cluster of **HIGH-severity** issues in the
live-marks display seam and the board→UI wiring (stale marks shown as live; an open position that could vanish
from the deck; a degraded board that rendered as a calm empty tape), plus honesty/calibration/provenance
findings. **As of 2026-07-24 the remediation is essentially complete — 10 fix PRs are merged to `main`** and
the two deploy-risky ones (aggression floor #1028, governor-txn #1031) are written + tested and held as drafts
pending one validation step each. Every finding is catalogued in §9 with its status and the full ledger is in
§10.

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

Legend: **[C]** CONFIRMED, **[P]** PLAUSIBLE. **✅ MERGED** = fix shipped to `main` (PR#). **⏸ HELD** = fix written + tested, held as a draft PR pending a validation step. **○ open** = not yet done.

> **Remediation status (2026-07-24):** every finding below is MERGED, HELD-for-validation, or a documented cosmetic leftover — see §10. Ten fix PRs (#1020, #1022–#1027, #1029, #1030) are on `main`; two (#1028 aggression floor, #1031 governor-txn) are held as drafts for their one validation step.

### HIGH
- **9-1 [C] ✅ MERGED (#1020) Stale SSE mark overlaid as LIVE** — `use-live-marks.ts` `overlayLiveMarks` ignored `row.stale`,
  replacing the fresher 5s board value with a >5s-old mark under a `● LIVE` badge; a dead lane froze its last
  frame. **Fixed in PR #1020** (skip stale rows + clear map on `CLOSED`).
- **9-2 [C] ✅ MERGED (#1020) Greeks carry-forward defeated by an all-null object** — `markFromSnapshot` emitted an all-null
  greeks object (not `== null`), blanking the Δ Γ Θ V IV strip on every unpriced snapshot. Fix: collapse all-null → `null`.
- **9-3 [C] ✅ MERGED (#1022) Degraded/unknowable board renders as a calm "flat tape"** — the deck derived plays only from
  `resp.setups` and never read `available/upstream_ok/degraded`; when the committed set is unknowable
  (`displaySetups=[]`) or the route returns `{available:false}` at HTTP 200, a member holding a live OPEN
  position saw zero rows + "no setup has cleared the floor" — a degraded board impersonating a healthy empty
  one. Fix: `isBoardDegraded()` → a distinct "board data unavailable — retrying" banner.
- **9-4 [C] ✅ MERGED (#1022) An open position can vanish from the deck** — the play list iterated **setups**, so a committed
  OPEN/HOLD/TRIM ledger row whose ticker aged out of the scan had no setup → never rendered; the member couldn't
  see/manage their live position. Fix: deck sources are now the **union** of setups and OPEN/HOLD/TRIM ledger rows
  (synthesized from ledger fields). Refactored into the pure `command-deck/zerodte-sources.ts`.
- **9-5 [C] ⏳ PARTIAL (#1020) Live deck wired to the weaker of two duplicate hooks** — `containers.tsx` imports the
  command-deck hook while a richer `hooks/useZeroDteLiveMarks.ts` (2.5s REST fallback + staleness clock) exists but
  is only wired to the now-dead `ZeroDteBoard`. **#1020 closed the correctness half** (the deck hook now skips stale
  rows + clears the map on a dead lane, so it no longer shows stale-as-live). The remaining item is a *robustness*
  cleanup — consolidate onto the rich hook (2.5s REST fallback for the SSE-503/edge-buffer case) and delete the dead
  board. **○ open follow-up** (not member-risk; the deck already falls back to the 5s board poll).

### MEDIUM
- **9-H1 [C] ✅ MERGED (#1026) Stale `market_regime` served as current** — `platform-intel-snapshot.ts` + `/api/platform/intel`
  read the latest `market_regime` row with **no trading-day freshness gate** (documented Fri→Sun 49h-stale incident),
  feeding member sizing notes + the AI prompt a days-old regime. Fix: propagated the same
  `formatEtDate(captured_at) != mostRecentTradingDay → null + regime_stale` gate the sibling `/api/market/regime` already used.
- **9-C1 [C] ✅ MERGED (#1025) Scale-out realized multiple inflated by intrabar look-ahead** — `scale-out.ts` updated `peak`
  from the current bar's high **before** testing the trailing stop against the same bar's low (on **daily** bars the ambiguous
  window is a whole session), biasing `recommendScaleOut` toward `enforce`. Fix: capture `prevPeak` before the max, test the
  trail against it, update peak after.
- **9-C2 [C] ✅ MERGED (#1023) Condor `est_win_rate` surfaced 92/96/100 with no breach companion** — a 25-session backtest can't
  support a literal 100% WR, and only close-settlement WR was exposed while the negative-skew product breaches ~1 session in 5
  (18.7%). Fix: cap the surfaced WR at 97 (`est_win_rate_small_sample` flag) + added `est_intraday_breach_pct` + `skew:"negative"`.
- **9-6 [C] ✅ MERGED (#1022) Board vs UI status labels** — gate-BLOCKED finds rendered as `WATCH` not `SKIP`; a committed OPEN
  with aged-out gate context showed "✗ Hard gate"; `market_aligned===null` rendered a green "✓ Tape align / thesis intact".
  Fix: status derives from the gate verdict (BLOCKED→SKIP); a working play passes the Hard gate; null-alignment is a new neutral
  "unknown" thesis state, never a false green.
- **9-7 [C] ✅ MERGED (#1027) Top-5-only edge layer corrupted gating + calibration for ranks 6-10** — `attachIntradayEdge` ran
  only on the top 5, but all 10 were gated + confluence-logged, so ranks 6-10 gated on an un-adjusted score, G-10 couldn't fire,
  and they were always logged `weak` — biasing the confluence dataset. Fix: compute the light intraday read for **every gated
  setup** (heavy dossier enrichment still top-N).
- **9-8 [P] ⏸ HELD (#1031, staging-verify) Cross-replica governor overshoot** — the concurrency/session-stop caps were enforced
  only in the pure pre-persist evaluation, not inside the upsert; two concurrent scan runs (cron + WS-trigger on different
  replicas) can each commit past the cap. Fix (written + tested): `INSERT … SELECT … WHERE (live-count < cap AND stop-count <
  halt) … ON CONFLICT` on the fresh commit, mirroring `deriveGovernorFromLedger` exactly. **Held as a draft** — touches the live
  commit-path SQL; needs a staging commit-cap test (4th fresh vs 3 live → blocked) before prod.
- **9-9 [P] ✅ MERGED (#1029) Exit engine could fire on a 5–30s-stale mark** via the `LATCH_MAX_MARK_AGE_MS=30000` fallback.
  Fix: split into two marks — the 30s `mark` feeds only the peak/trough latch + plan hard-stop (capital protection must not
  depend on freshness); a fresh-only (≤5s) `engineMark` is what the ratchet/thesis/flat exits act on (else the engine HOLDs).
- **9-C3 [C] ✅ MERGED (#1025) Two disagreeing win definitions** — `isZeroDteWin = pnl>0` (record + calibration) vs the feature
  store's `doubled=win, time_stop=loss`. Fix: aligned the feature store to `plan_pnl_pct > 0` (a green time-stop is a win in both).

### LOW (cleanups toward "a null is honest, a fabricated zero is a lie")
- **9-P1 [C] ✅ MERGED (#1024) Index-option underlying dropped** — the unified snapshot read `underlying_asset.price`; Polygon
  sends `.value` for index OCCs (SPX/SPXW/NDX/RUT/VIX) → `underlyingPrice` null for index-option valuation. Fix:
  `underlying_asset.price ?? underlying_asset.value` (still null when neither). + a conservative `normalizeImpliedVol()` helper.
- **9-H2 [P] ✅ MERGED (#1026) Empty positioning fallback** emitted `net_gex:0 / negative_gamma:false / source:"polygon"` with no
  `available` field — "no data" looked like "flat book." Fix: the empty branch returns `null`; `negative_gamma` is now nullable;
  `/api/market/gex-positioning` degraded fallback `change_pct`/`net_vex` → `null`.
- **9-floats [C] ✅ MERGED (#1027) Unrounded floats** — raw UW underlying + VIX interpolated into SKIP-card reason strings
  (`VIX 17.34000…01`) reached the member/ledger. Fix: round the underlying at aggregation + `vixR` in every gate reason string.
- **9-C5 [P] ✅ MERGED (#1025) Grader intrabar asymmetry** — the committed grader included the flag bar (`t < flag`) while the
  skip grader excluded it (`t+1`). Fix: skip `bar.t <= flaggedAtMs` — grading starts strictly after the flag in both.
- **9-P/IV [C] ✅ MERGED (#1024) IV unit inconsistency** — provider returns decimal (0.229) for live rows, `20`/`15.83`
  placeholders for expired/edge rows. Fix: opt-in `normalizeImpliedVol()` rescales only impossible-as-decimal values (≥500%);
  the mapper still stores raw IV verbatim.
- **9-misc-null [C] ✅ MERGED (#1029, #1030):** `markStore` never evicted → `pruneMarkStore` (#1029); SSE per-tick dedupe was dead
  code (`as_of` in every frame) → content-key dedupe excluding time-only fields (#1029); empty-sample analytics win rates returned
  `0` not `null` → `null` (#1030); cortex unpriced flow premium `?? 0` → `null` (#1030); banger `hold_mult` measured hold-to-last-bar
  not hold-to-expiry → `ungradeable` when the forward series is truncated (#1030).
- **9-misc-cosmetic ○ open (no member impact):** `net_premium` is aggression-weighted not raw (misleading field name); `dte`
  (ticker-min) can disagree with `expiry` (top-strike) label; Night Hawk dedupe misses `SPX`↔`SPXW` root aliasing. Left as-is —
  2 of the 3 carry filter/exclusion behavior risk not worth churn for a naming nicety. `OPTIONS_WS_ENABLED` likely unset in prod
  (marks ride the REST poller — still genuine ~1s, the WS path is dead weight) — an ops config note, not a code defect.

- **9-1-aggr [C] ⏸ HELD (#1028, sim-validate) Aggression gate fails OPEN on missing ask-side metadata** — when every print for a
  ticker lacks `ask_pct`, `aggressionWeight` returns the neutral 0.5 for all, so the aggression share ≈ 0.5 clears
  `SETUP_MIN_AGGR_SHARE` (0.3) with **zero real aggressor evidence** and direction reverts to a raw call-vs-put split. Fix (written
  + tested): track `knownAskPrem` and require `knownAskPrem/gross ≥ SETUP_MIN_KNOWN_AGGR_FRAC (0.5)` before the aggression gate
  passes (fail-closed, like `no_underlying_price`). **Held as a draft** — it changes *what commits*; the 0.5 threshold needs a
  market-hours `sim:0dte` before/after to confirm it doesn't starve the board, then tune on the evidence.

### Verified SOUND (checked, not defects)
Marks/P&L null-honesty; greeks OCC-keyed carry-forward; GEX positioning returns null on cold cache; base-rate
`MIN_SAMPLES`/`low_n` discipline; live-session & expiry look-ahead guards; MOVED-fill inflation blocked by G-8;
survivorship (ungradeable never imputed); conservative tie handling (same-bar → stopped, hard-stop before 2×);
allocation is advisory-only (never sizes); selection state stable across polls; both-direction P&L sign.

---

## 10. Remediation status (as of 2026-07-24)

The audit was run, then remediated in two waves. **10 fix PRs are merged to `main`**; the two deploy-risky
ones are written + tested and held as drafts pending their single validation step.

### ✅ Merged (10 PRs)
| PR | Findings closed |
|---|---|
| **#1020** | 9-1 stale-mark overlay · 9-2 greeks-null carry-forward |
| **#1022** | 9-3 degraded-board state · 9-4 open-position union · 9-6 honest gates/status · (PnL peak/trough dead-data) |
| **#1023** | 9-C2 condor win-rate cap + breach/skew |
| **#1024** | 9-P1 index-option underlying · 9-P/IV normalization helper |
| **#1025** | 9-C1 scale-out look-ahead · 9-C3 win-def unification · 9-C5 grader flag-bar |
| **#1026** | 9-H1 stale-regime gate · 9-H2 empty-positioning null |
| **#1027** | 9-7 intraday-edge coverage · 9-floats underlying/VIX rounding |
| **#1029** | 9-9 exit-needs-fresh-mark · markStore eviction · SSE dedupe |
| **#1030** | analytics 0→null · cortex premium null · banger hold_mult |
| **#1021** | this document |

### ⏸ Held as drafts (2 — deploy-risky, one validation step each)
- **#1028 / 9-1-aggr** — aggression evidence floor. Changes *what commits*; needs a market-hours `sim:0dte`
  before/after (confirm the known-aggressor floor doesn't starve the board; tune `SETUP_MIN_KNOWN_AGGR_FRAC`).
- **#1031 / 9-8** — governor-in-transaction. Touches the live commit-path SQL; needs a **staging** commit-cap
  test (a 4th fresh find against 3 live → blocked; a 3rd against 2 → commits) before prod merge.

### ○ Open, non-blocking
- **9-5** hook consolidation — the *correctness* half shipped in #1020 (deck no longer shows stale-as-live); the
  remaining REST-fallback consolidation + dead-`ZeroDteBoard` deletion is a robustness cleanup, not member-risk.
- **9-misc-cosmetic** — `net_premium` naming, `dte`/`expiry` label, `SPX`↔`SPXW` dedupe aliasing. No member
  impact; 2 of 3 carry filter/exclusion behavior risk not worth the churn.

_None of these ever blocked the system from operating. The HIGH cluster was about not showing a member a
stale-or-absent value as if it were live — the exact failure mode eliminated for a real-money desk._
