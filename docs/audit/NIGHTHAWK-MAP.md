# NIGHT HAWK — THE MAP

**Phase 0 deliverable of the Night Hawk owner lane (`docs/agents/briefs/nighthawk.md`).**
Living inventory. Kept current forever after — when this file and the code disagree, the code
wins and this file is a bug.

Its job is to let a stranger answer, for every displayed field: *what is this · where does it come
from · how is it calculated · what source generated it · when was it last updated · what units ·
what makes it unavailable · how do we know it is correct · where else is this value consumed.*

**Where an answer is not known, this file says `UNKNOWN`.** Night Hawk is the most
money-adjacent product in the fleet — a wrong number here is a member's account, not a UX defect.
An honest gap is a finding; a plausible guess is a lie that outlives whoever wrote it. Every
`UNKNOWN` below is a work item.

> **Provenance of this document.** Everything below was read out of the code at `9b20b63c`
> (2026-08-22) on Node 20.20.2. Nothing is carried forward from a prior document without being
> re-checked — §9 is the list of places where the prior documents, including this lane's own
> charter, turned out to be wrong.
>
> **This does not replace `docs/audit/NIGHTHAWK-DATA-PROVENANCE.md`.** That document is organised
> on the **source** axis (which upstream, which transport, is it ingested, is it a proxy). This one
> is organised on the **displayed-field** axis (what does a member see, and what stands behind it).
> They are complements. Where they overlap, this file is newer — see §9.

---

## 1. Coordinates

**The member route is `/nighthawk`** (`src/app/(site)/nighthawk/page.tsx`). There is no
`/night-hawk` and no `/swings`; an unstyled Times-New-Roman render is the 404 page, not a CSS
failure.

`page.tsx` → `requireDeskTool("premium", "nighthawk")` → `<NighthawkPageShell seed={…}>`.
`force-dynamic`, `noindex`. **The page deliberately does NOT server-render the board**: `seed.board`
is hard-coded `null` and the client SWR-loads `/api/market/zerodte/board`, because SSR-ing it put
TTFB behind a cold board rebuild (the same 30–60s class as the old Vector dashboard SSR).

| Area | Where | Count (verified) |
|---|---|---|
| 0DTE engine core | `src/lib/zerodte/` | **141 `.ts` = 70 source + 71 test**, 41,281 lines |
| Cortex engine | `src/lib/nighthawk/cortex/` | 26 files (13 source + 13 test), all under `cortex/` |
| Feature lib | `src/features/nighthawk/lib/` | 136 files = 69 source `.ts` + 66 `.test.ts` |
| Components | `src/features/nighthawk/components/` | 22 files, of which **12 `.tsx`** |
| Member APIs | `/api/market/nighthawk/{edition,horizons,hunt,play-explain,record}`, `/api/market/zerodte/{board,calibration,marks,marks/stream,record}` | 10 |
| Admin APIs | `/api/admin/nighthawk/{analytics,horizon-outcomes,publish-preview,regrade-stuck-outcomes,run}`, `/api/admin/zerodte/{funnel,graduation,health,regrade-index-roots,sim/board}` | 10 |
| Crons | `banger-discovery`, `banger-live-sync`, `nighthawk-edition`, `nighthawk-morning-confirm`, `nighthawk-outcomes`, `swing-active-refresh`, `swing-discovery`, `zerodte-grade`, `zerodte-warm` | 9 — the most of any product |
| Largo tools | see §8 | 10 — the most of any product |

Largest engine files: `scan.ts` (1897), `board.ts` (1733), `calibration.ts` (1361), `gates.ts`
(1209), `governor.ts` (901), `live-marks.ts` (790), `thesis-health.ts` (737), `plan.ts` (733),
`exit-engine.ts` (654), `record.ts` (578), `condor.ts` (526).

### Test baseline

**1889 pass / 0 fail**, Node 20.20.2, at `9b20b63c`:

| Suite | Command | Result |
|---|---|---|
| Engine | `node --import tsx --experimental-test-module-mocks --test src/lib/zerodte/*.test.ts` | 1130 pass / 0 fail (52.3s) |
| Feature lib | same, `src/features/nighthawk/lib/*.test.ts` | 759 pass / 0 fail (19.3s) |

Quote this as the baseline. **A run on Node 22, or a run before `npm ci`, is not evidence.** This
container had Node 20 pre-installed at `/opt/node20/bin` **and an empty `node_modules`** — the
phantom-failure trap arriving from the direction `_COMMON.md` was corrected on in #2633. `node -v`
and `ls node_modules` cost nothing; run both first.

---

## 2. THE SERVE MODEL — read this before any freshness question

Night Hawk serves through **three independent freshness lanes**, each with its own cache, its own
age bound, and its own failure mode. Conflating them is how a "stale data" report gets
mis-diagnosed. All three are `no-store` at the HTTP layer — the freshness *is* the product.

| Lane | Key / transport | Cadence | Serve bound | Builder |
|---|---|---|---|---|
| **Board** | Redis `zerodte:board:snapshot:v1` | rebuild when snapshot > **5s** old (`BOARD_SNAPSHOT_REFRESH_MS`) | Redis TTL **600s**; SWR serve ≤600s; soft-stale serve ≤**10min** (`BOARD_STALE_SERVE_MAX_AGE_MS`) | `buildAndPublishBoard` → `getZeroDteBoardPayload` |
| **Live marks** | Redis `nw:optmark:*` write-through + SSE | poll tick **1s** (`POLL_TICK_MS`); payload memo **900ms** | a mark older than **5s** (`ZERODTE_MARK_STALE_MS`) MUST render stale | `live-marks.ts` → `/marks` (REST) + `/marks/stream` (SSE) |
| **Record** | Postgres `zerodte_setup_log`, no cache | on request | `?days=N`, default 30, cap 90 | `buildZeroDteRecord` |

### The board's convergence guarantee — why it is a *shared* snapshot

The board used to be assembled **per replica** and served from each replica's in-process cache.
Two replicas warm their score inputs at different instants, converge to their own stable-but-
different scores, and a member's ~5s SWR poll round-robins between them — so **setup scores
flip-flopped between two values** (proven live 2026-07-24: QQQ 68↔50, MU 52↔56, SNDK 60↔52 across
a four-round poll while `as_of` advanced every round). The live *marks* never flipped, because they
already rode a shared Redis write-through.

The fix gave the whole board that property: **one shared snapshot in Redis that every replica
reads**, refreshed single-writer (`BOARD_BUILD_LOCK_KEY`, 20s lock TTL) on an SWR cadence. Any two
replicas now serve the identical board.

### The never-block ladder

`getZeroDteBoardPayload` never awaits a cold build. It races the build against
`zerodteBoardMaxBlockMs()` (**default 3000ms**, env `ZERODTE_BOARD_MAX_BLOCK_MS`, floor 500ms —
**confirmed NOT overridden in production**, §11) and
on timeout falls through, in order: shared Redis snapshot → per-replica last-good board →
`buildMinimalBoardFallback()` (a structurally valid EMPTY board). The cold build keeps running and
publishes for the next poll.

> **The trap this encodes:** an empty board can mean *"nothing qualified"* or *"the 3s ladder ran
> out and you are looking at the fallback."* Those are different facts. `discovery_health` (§4.3)
> is what separates them — read it before calling a board empty.

---

## 3. The trace — one play, discovery to grade, function by function

The charter's Phase 0 trace. Entry points: the `zerodte-warm` cron calls `warmZeroDteBoard()` every
~2 min through RTH (so the system hunts all session even when nobody is looking); a member poll
calls `scanZeroDteBoard()`, collapsed to one build per 5s.

**1 · Session context.** `todayEt()` → `fetchZeroDteSessionContext()` (day-open VIX + SPY bias) →
`loadShadowRailPriors()` → `calibrationPriorBlendFactor()` → `buildMarketState()` produces the
regime-adaptive rail weights (`MarketStateSnapshot`).

**2 · Raw flow.** Three parallel reads:
`fetchRecentFlows({since_hours: 7, min_premium: MIN_PREMIUM_NEAR_DATED, order: "premium", limit: 500, max_dte: 1})`
— **`max_dte: 1` is load-bearing.** Without it the top-400 spans all expiries and heavy-day whale
prints crowd every 0DTE print out of the input (live-reproduced: a $3.1M AAPL stack → 0 setups).
Alongside: `fetchLatestNighthawkEdition()` (for `covered_elsewhere`) and a **wide** multi-day
`fetchRecentFlows` (all expiries) for the accumulation engine. A flow failure sets `upstream_ok=false`;
the other two degrade to null/empty and never break the scan.

**3 · FLOW discovery.** `deriveZeroDteSetups(...)` — the four evidence gates (gross premium,
at-the-ask aggression share, side dominance, deep-ITM stock-replacement) — `{maxSetups: 48}`.
Near-misses go to `rejections[]` and surface through `get_zerodte_rejections`.

**4 · Enrichment.** The top `ENRICH_TOP_N` (**12** — raised 5→12 because ranks 6–12 were starving
mid-board commits of dossier/Cortex inputs) get `fetchTickerDossier` behind a Redis single-flight
(`zerodte:dossier:{ticker}:{today}`, TTL **10 min**, shared across all pollers *and* the cron warmer
so nothing multiplies dossier builds), bounded by `within(…, 3000ms)`; the rest get
`enrichSetup(setup, null, extras)`. → `EnrichedZeroDteSetup` (`dossier_score`, `conviction`,
`direction_confirmed`, `factor_breakdown`).

**5 · BREAKOUT lane.** `discoverBreakoutSetups()` (dynamic import, so a flow-only board never loads
the whole-market module). Outcome is **discriminated**: `data_unavailable` on a snapshot that could
not be proven fresh ≠ an empty market. Merged by `mergeDiscoveryOrigins`.

**6 · PIN lane.** `discoverPinSetups()`, same dynamic-import and merge shape
(`mergePinOrigins`). Origin is preserved as a **SET** — a shared ticker becomes `["FLOW","PIN"]`,
never a collapsed single origin.

**7 · Merge rank.** `weightedScoreForMerge(score, discovery_origin, marketState)`, with true 0DTE
preferred over 1DTE on ties. Shadow-safe: it re-sorts only.

**8 · Overlays.** `attachFlowAccumulation` (multi-day memory) → `attachContractPlans` (Polygon
`/v3/snapshot` → `pickChainContract` → `buildContractPlan`) → `attachIntradayEdge` (minute bars,
returns the SPY tape `bias` + `biasAsOfMs`) → `attachConfluence`.

**9 · Gates + Cortex.** `attachGateVerdicts(setups, tape.bias, tape.biasAsOfMs, nowEtMinutes)` runs
**last**, so G-3 judges the final post-overlay score and G-1 reuses the same SPY read. Cortex runs
*inside* it, on gate survivors only, with `failClosedOnVetoBlind: true`. Full gate stack in §5.

**10 · Commit.** `persistZeroDteScan(setups)`:
- **Horizon-integrity fail-closed guard** — anything `WEEKLY_FALLBACK` (dte ≥ 2, or a fail-closed
  unknown horizon) is DROPPED before commit, so the ledger stays structurally homogeneous (all
  same-day-graded), which is the precondition per-horizon calibration depends on.
- `fetchZeroDteSetupLog(today)` — **returns 0 on a null read** (fail closed: fresh-vs-committed is
  unknowable, so commit nothing).
- Past the directional cutoff only a fresh CONDOR may open (G-14 exempts credit seats).
- `buildZeroDteEntryContext` assigns the **tier**, which now selects the exit archetype (A/B → 
  `trim_scale`, C → `ratchet`; `ZERODTE_EXIT_MODE=ratchet` forces all back). Because the mode varies
  per play, the strategy manifest/hash and exit-policy snapshot are built **per play** inside the
  upsert loop.
- `commitFreshZeroDteRowsAtomic` / `upsertZeroDteSetupLog` — the upsert **COALESCE-pins**
  `entry_context`/`feature_vector` at FIRST flag, so a later refresh tick or a manifest bump never
  re-stamps an existing row.

**11 · Live marks.** `ensureZeroDteMarkPoller()` ticks at 1s: WS quote if fresher than
`WS_FRESH_MS` (2.5s), else REST. `advancePlayLatch` widens `peak_premium`/`trough_premium` using
only marks younger than `LATCH_MAX_MARK_AGE_MS` (30s); `PERSIST_HEARTBEAT_MS` (10s) throttles
writes. A **mark-driven engine exit may only act on a quote ≤ `ZERODTE_MARK_STALE_MS` (5s)**.

**12 · Exit management.** `exit-engine.ts` → `buildExitContext` stamps `entry_context.exit`
**first-write-wins** (`db.stampZeroDteExitContext`). `categorizeExitReason` maps the raw reason to
one of five families — `ratchet · thesis · flat · target · stop` (§6).

**13 · Grading.** `gradeZeroDteLedger()` (the `zerodte-grade` cron) → `gradeZeroDteSetupRow` writes
the mechanical `plan_outcome`/`plan_pnl_pct`; `stampZeroDteExecutableGrade` writes the executable
lane into `entry_context.executable`, including `reconstructTrimScaleExecutableFromBars` for
trim-scale rows. §7 is why there are two numbers and which one is official.

---

## 4. Field inventory — the board payload

`ZeroDteBoardPayload`, `zerodte-service.ts:249`. Served by `/api/market/zerodte/board`.

### 4.1 Envelope

| Field | Meaning | Units | Unavailable when |
|---|---|---|---|
| `available` | always `true` on this shape | bool | the route's catch returns `{available:false, degraded:true}` instead |
| `as_of` | build instant of the shared snapshot | ISO-8601 | — |
| `upstream_ok` | the FLOW `fetchRecentFlows` read succeeded | bool | `false` = flow upstream threw; board still serves |
| `session.date` | ET session date | `YYYY-MM-DD` | — |
| `session.trading_day` | `isTradingDayEt(todayEt())` — **a market holiday is not a trading day no matter what the weekday says** | bool | — |
| `session.heat` | `sessionHeat()` phase | enum | — |
| `governor` | G-5 session risk state | object | **`null` = unreadable this build, rendered "unavailable", never guessed.** The gate stack independently fails closed on the same read |
| `market_state` | regime-adaptive rail weights for this scan | object | `null` |
| `discovery_funnel` | top session rejection reason | object | `null` |
| `spx_slayer_badge` | SPX Slayer's own live play, **display only** | object | `null` only on a pre-field cached snapshot. **Not a discovery lane** — the only behavioural coupling to SPX Slayer is the G-6 conflict veto |
| `allocation` | Portfolio Allocation Engine — **ADVISORY**, does not gate the engine or resize a real position | array | empty when the committed set is unknowable this build |
| `covered_elsewhere` | tickers last night's NH edition already covers | string[] | — |

### 4.2 `setups[]` — fresh finds (`EnrichedZeroDteSetup`)

Selected fields. A fresh find is **NEVER an open position** and must not be presented as one —
`status` is `WATCH` (uncommitted candidate) or `SKIP` (refused find).

| Field | Meaning / provenance | Notes |
|---|---|---|
| `direction` | `long`/`short` | For a **CONDOR this is NOMINAL provenance only** (the fade side of the pin) — the structure is neutral and the directional gates and −50/+100 grader do not apply |
| `play_type` | `DIRECTIONAL` \| `CONDOR` | CONDOR only ever produced by the flag-gated router in `condor.ts` |
| `discovery_origin` | SET of `FLOW`/`BREAKOUT`/`PIN` | never collapsed to one; persisted so calibration can slice by origin |
| `contract_horizon` | `ZERO_DTE`/`ONE_DTE`/`WEEKLY_FALLBACK` from the REAL selected-contract dte | only the first two ever commit |
| `actual_dte_at_commit` | real dte of the selected contract | so "which horizon was this graded on" is answerable at the ledger without inferring from expiry |
| `side_dominance` | premium-weighted dominance of the winning side | 0.5–1 |
| `underlying_price` + its as-of | spot behind the setup | the as-of exists because the flow lane historically **threw it away**, making an hours-old stamp indistinguishable from a live spot |
| `dossier_score` / `conviction` | audited scorer, 0–100 | `null` outside `ENRICH_TOP_N` or on dossier timeout |
| `factor_breakdown` | per-component points, **a MAP not a fixed record** | FLOW rows carry `flow/tech/positioning/news/smart_money`; BREAKOUT rows carry `breakout_core/dollar_volume/screen_base`. Deliberately open so a lane can explain itself in its own vocabulary |

### 4.3 `discovery_health` — the anti-"quiet market" field

`Record<"BREAKOUT"|"PIN", {status, setups, reason?}>`. **The load-bearing distinction is `ok` vs
everything else:** `ok` means the lane RAN and its count is a real market read *including a genuine
zero*. Every other status means the count is **not a market read at all** — it is an absence, and a
reader must not average it in or call it quiet.

`ok · disabled · off_hours · empty_market · data_unavailable · failed`

Default is `disabled`, not `ok` — a lane that never got to record its status must not read as a
healthy zero. Measured live 2026-08-14: two passes minutes apart served 84 then 19 setups with
nothing in either payload explaining the collapse. From outside, a 75%-smaller board and a calm
market were the same bytes. This field is that difference.

### 4.4 `ledger[]` — committed plays (`ZeroDteBoardLedgerRow`)

The money-adjacent surface. Grouped by concern:

**Identity / entry** — `ticker`, `direction`, `expiry`, `top_strike`, `occ` (the SSE overlay key;
`null` on a commit that never froze a contract), `first_flagged_at`, `underlying_at_flag`,
`entry_premium`, `conviction`, `score_max`, `discovery_origin`.

**Live pricing** — `last_mark`, `bid`, `ask`, `greeks` (Δ Γ Θ V IV), `live_pnl_pct` (mid),
`live_pnl_pct_exec` (**sell-into-the-bid — the number a member could actually realise now**),
`peak_premium`, `trough_premium`, `peak_pnl_pct`, `floor_pnl_pct` (the armed protective ratchet
floor — guidance the engine computed but that never reached the member before).

**Mark provenance — three fields, and they exist to prevent one specific lie:**
- `mark_as_of` — ISO instant of the quote behind `last_mark`; `null` = legacy sync lane.
- `mark_source` — `mid` (two-sided quote) \| `last` (last-trade fallback, flagged) \| `null`.
- `mark_is_sync` — `true` when the mark came from the **board** lane, which carries no per-quote
  timestamp. Without it, a member cannot tell an unknown-age board mark from a 1s-fresh live one.

**Exit** — `status`, `closed_reason` (`stopped` \| the five categories \| `time_stop` \| `null`),
`exit_reason`, `exit_detail` (the member-facing rationale sentence, verbatim), `exit_at`,
`exit_pnl_pct`, `exit_policy` (the REAL resolved ladder, from the row's FROZEN policy snapshot —
the terminal renders this instead of a hard-coded ratchet track), `timeline_tranches`.

**Exit-mark honesty — the pair that must always be read together:**
- `exit_mark_honored` — `true` when the frozen mark was **raised to honour a protective floor/stop**,
  i.e. it is an INFERRED fill at the armed level, not the observed print.
- `exit_mark_observed` — the RAW observed mark before honouring.
- `null` on a live or legacy row. **Absence must not read as "definitely observed."**

**Frozen commit-time evidence** (served opaque, validated structurally client-side; `null` on rows
predating each wiring — the pane then shows an honest gates-only line, never a re-derived table):
`cortex`, `tier`, `flow_accumulation`, `exit_policy_at_commit`.

**Grading** — `plan_outcome`, `plan_pnl_pct`, `graded`, `move_pct`, `direction_hit`.

---

## 5. The gate stack

`evaluateZeroDteGates` (`gates.ts`). Rejection codes are the vocabulary `get_zerodte_rejections`
serves.

| Gate | What it blocks | Codes |
|---|---|---|
| **G-1** | tape alignment vs the SPY read | `no_market_bias`, `tape_alignment`, `regime_blind` |
| **G-2** | opening window | `opening_window` |
| **G-3** | score floor, **origin-aware** (`scoreFloorForOrigins`; BREAKOUT/PIN share a 65 floor) | `score_floor` |
| **G-4** | VIX regime throttle. Condor variant blocks at **extreme** VIX (≥20) only, not elevated (17–20) — a condor wants low vol | `vix_extreme`, `vix_elevated`, `vix_unavailable`, `condor_vix_regime` |
| **G-5** | session governor (risk state) | via `governor` |
| **G-6** | cross-system conflict with SPX Slayer (index + sympathetic mega-cap tech) | `cross_system_conflict` |
| **G-7** | macro calendar. For a condor a release blocks the **whole session** — it is a condor's worst case | `macro_hard_block`, `macro_unavailable`, `condor_macro_block` |
| **G-8/G-9** | plan quality (replaced by the condor liquidity gate on a condor) | `plan_no_quote`, `plan_moved`, `plan_illiquid`, `plan_quote_stale`, `plan_quote_invalid` |
| **G-10** | name's own VWAP/5m trend opposes the play | **not a hard gate — DEMOTED back to score-only 2026-07-27.** It contributes to the score and never blocks a commit on its own |
| **G-11** | halts + earnings | `halted`, `halt_feed_stale`, `earnings`, `earnings_unavailable` |
| **G-12** | confluence floor | `confluence_floor` |
| **G-13** | multi-day flow accumulation must agree with direction | `flow_accumulation_conflict` |
| **G-14** | late-afternoon block (exempts fresh credit/condor seats) | `late_afternoon` |
| — | context unreadable → fail closed | `gate_context_unavailable`, `source_recovering` |

**The condor is a different gate path, not the same path with different numbers.** On the
delta-neutral branch the directional gates — G-1, G-6, G-10, G-12 — are **SKIPPED**, G-8/G-9 are
replaced by the condor liquidity gate, G-4 blocks harder, and G-7 blocks the session.

### Phase-0 firewall kill-switches (all fail-closed, all ON by default)

**All four confirmed NOT overridden in production (§11)** — so "ON by default" is the deployed
fact here, not merely the code's intent.

| Env | Default | Effect when the input is unavailable |
|---|---|---|
| `ZERODTE_G4_FAIL_CLOSED` | on | a fresh commit HOLDS when a present VIX could have blocked it |
| `ZERODTE_G7_FAIL_CLOSED` | on | HOLD rather than trade a blind macro calendar |
| `ZERODTE_G11_FAIL_CLOSED` | on | HOLD rather than trade a name possibly reporting today |
| `ZERODTE_G11_HALT_FAIL_CLOSED` | on | HOLD rather than commit into a possible halt on a blind feed |

---

## 6. Exit taxonomy

`categorizeExitReason` (`exit-engine.ts:588`) is the **single source of truth** for the vocabulary,
so the board and pane never re-derive it from string prefixes and drift.

| Category | Raw reasons |
|---|---|
| `thesis` | `thesis_break*` |
| `stop` | `plan_stop` |
| `flat` | `flat_theta_bleed` |
| `target` | `plan_target*`, `trim_scale*` (both modes: banked profit at/toward target) |
| `ratchet` | `ratchet*`, `runner_floor*` (the breakeven/profit floor and post-trim runner floor) |
| `null` | holds, floor-arms, guards, and any unknown token — **not an exit** |

---

## 7. Two grading tracks — which number is official, and why there are two

**Read `docs/audit/OUTCOME-GRADING-SPEC.md` before touching any win/loss logic.** This section is
the short form.

Every row is graded twice:

| Track | What it is | Where it lives |
|---|---|---|
| **MECHANICAL** | the fixed −50% / +100% / 15:30-ET plan grade | `plan_outcome`, `plan_pnl_pct` columns |
| **AS-MANAGED** | the exit the member was **actually live-guided to take** | `entry_context.exit`, falling back to mechanical when no engine exit fired |

**The member-facing headline is AS-MANAGED.** The mechanical grade is reported beside it as a
labeled hold-to-stop/target comparison, **never blended in** (`ZERODTE_RECORD_METHODOLOGY`).

- `officialPlanPnlPct(row)` = `readExecutableGrade(entry_context)?.plan_pnl_pct ?? row.plan_pnl_pct`
- `officialPlanOutcome(row)` is kept in lockstep, so the label and the P&L always agree.
- `isZeroDteWin(row)` = `officialPlanPnlPct(row) > 0`.
- **WS-11:** a trim-scale row's executable grade IS the reconstructed ⅓/⅓/⅓ as-managed path
  (`readReconstructedTrimScale`, signalled by a non-empty `tranches` array), so the member headline
  reads the same number the calibration lane grades. Ratchet/legacy rows carry no tranches and keep
  the prior behaviour.

**Three-way partition, enforced:** `wins + losses + breakeven == graded`. `breakeven` is P&L exactly
0 — counted in `n` and in the win-rate denominator, excluded from both wins and losses.

**`LOW_N_THRESHOLD = 5`** — buckets below it are flagged `low_n` so a 2-sample bucket never reads as
a track record.

**The condor is recorded separately, on purpose.** A sold condor grades WIN = close-inside /
LOSS = breach — the opposite skew from a long-premium P&L sign. `buildZeroDteRecord` excludes
condor rows from the directional numbers and gives them their own `CondorRecord`. Blending them
mixes two instruments.

**Never blend across products.** These are option-premium returns — not SPX Slayer point results
and not Night Hawk edition stock-move percentages. Three methodologies, never merged.

---

## 8. The Largo boundary — 10 tools

Defined in `src/lib/largo/tool-defs.ts`.

| Tool | Answers | The distinction it exists to protect |
|---|---|---|
| `get_zerodte_plays` | today's ledger + top-5 fresh finds + `rules` + `iron_condor` | **The ONLY tool carrying the condor.** Win rate must ALWAYS be paired with the ~18.7% intraday-breach rate — negative skew, never free edge |
| `get_zerodte_rejections` | *why* a ticker did NOT make the board | `get_zerodte_plays` structurally cannot answer this — it only ever shows candidates that cleared every gate |
| `get_zerodte_record` | multi-day 0DTE track record | as-managed headline; mechanical as labeled comparison |
| `get_nighthawk_edition` | a published evening edition (`date` param for a past one) | not the 0DTE board |
| `get_nighthawk_outcomes` | realized win/loss over a window + pending | **has been truncated in production twice** — see §9 |
| `get_nighthawk_horizons` | the multi-day swings lane | not the evening edition, not 0DTE |
| `get_nighthawk_dossier` | per-ticker research behind a pick | falls back to the durable archive once an edition publishes; response carries `archived: true` |
| `get_spx_vs_nighthawk_comparison` | head-to-head vs SPX Slayer over one window | **pre-computed server-side so the model never subtracts two other tools' numbers itself** |
| `get_lotto_live` | current live SPX lotto play | read-only record |
| `get_lotto_state` | today's lotto state | — |

Adjacent (not owned, but the denominator rule is ours to police): the publish-gate cost tool's
`by_gate` rates are over `decided_n` (wins+losses), **not** `blocked_n` and **not** `graded_n`.
"3 of 16 (23.1%)" does not check out; "3 of the 13 that would have decided (23.1%)" does.

**Cross-product disagreement is REPRESENTED, never reconciled.** `get_spx_vs_nighthawk_comparison`
exists precisely to surface disagreement with SPX Slayer's 0DTE-adjacent read, not to average it
away.

---

## 9. Prior art that is now WRONG

### 9.1 `NIGHTHAWK-DATA-PROVENANCE.md` §0 DANGER list — **D1, D2 and D3 are all FIXED**

That list was built 2026-07-25 and still reads `queued`. Verified in the tree at `9b20b63c`:

| # | Was | Now |
|---|---|---|
| **D1** | earnings gate fails OPEN — a failed `readGridEarnings()` yielded an empty map and G-11 only blocked when earnings `!= null` | **FIXED.** `scan.ts:735` resolves `earningsUnavailable`; `gates.ts:813` blocks a fresh commit with code `earnings_unavailable` under `G11_EARNINGS_FAIL_CLOSED_ENABLED` (`ZERODTE_G11_FAIL_CLOSED !== "0"`) |
| **D2** | halt/LULD fails OPEN on the board — `{failClosedOnStale:false}` meant a cold halt socket produced no hold | **FIXED.** `scan.ts:698` explicitly cites the D2 fix; `gates.ts:781` blocks on `haltFeedStale` with code `halt_feed_stale` under `G11_HALT_FAIL_CLOSED_ENABLED`. The per-ticker read deliberately keeps `failClosedOnStale:false` so a naturally-quiet channel does not flag every name; the **global** staleness signal is what fails closed |
| **D3** | option-quote staleness never checked — `quoteAgeMs` never plumbed, the WS-04 `stale` predicate dead code in prod | **FIXED.** `scan.ts:960` computes `computeQuoteAgeMs(snap.observedAtMs ?? snap.quoteUpdatedMs, nowMs)` and passes it to `buildContractPlan`; `plan.ts:136` enforces `QUOTE_VALIDITY.max_quote_age_ms = 60_000` → code `plan_quote_stale` |

D4 (GEX wall veto no-ops on a cold ladder) remains **by design** and documented. D5 was never a
true fail-open.

**Do not re-derive these.** The DANGER table should be read as history, not as an open punch list.

### 9.2 The lane charter's own coordinates were slightly off

`docs/agents/briefs/nighthawk.md` says "verified 2026-08-22", but three counts do not match the
tree at `9b20b63c`:

| Charter | Actual | Note |
|---|---|---|
| feature lib "132 files" | **136** (69 source + 66 test + 1 other) | — |
| components "18 files" | **22 files**, 12 of them `.tsx` | the 18 was likely `.ts`+`.tsx` at an earlier commit |
| `src/lib/nighthawk/` "(5 files)" | **26 files**, all under `cortex/` | the largest discrepancy — the Cortex engine is a 13-source-file subsystem, not 5 loose files |

The engine figure the charter gives — `src/lib/zerodte/` at 41,281 lines — **is exact.**

### 9.3 `banger-discovery`'s DST defect is fixed in the mirror — deployment state is UNKNOWN

`cron-registry.ts:529` now carries `schedule_cron_utc: "15 20,21 * * 1-5"` with the reasoning in
place: 20:15 UTC is 16:15 ET under EDT, 21:15 UTC is 16:15 ET under EST, so **one fire always lands
after the 16:00 ET close**, and the route's `inEtWindow` guard skips the off-band fire *before*
claiming the day so the skip cannot lock out the good fire. It was `15 20 * * 1-5`, which ran 45
minutes **before** the close all winter and committed positions off an unsettled tape.

**But `cron-registry.ts` is only a MIRROR.** The deployed schedule lives in the `blackout-infra`
EventBridge manifest, which is not in this repo's session scope. `cron-dst-audit.mjs` refuses to
print a verdict without that file, correctly. **Whether production actually carries the two-hour
schedule is UNKNOWN from here** — see §10.

---

## 10. UNKNOWNs — the work items

Every line here is a gap, not a conclusion.

| # | UNKNOWN | Why it is not answerable from the tree | How to close it |
|---|---|---|---|
| U1 | Does deployed EventBridge carry `banger-discovery`'s two-hour schedule? | `blackout-infra` is out of session scope; the registry is a mirror | run `scripts/audit/cron-dst-audit.mjs --infra=<path>` with the infra repo attached |
| U2 | DST-correctness of the remaining NH crons | the 2026-08-21 audit covered `nighthawk-morning-confirm`, `nighthawk-outcomes`, `swing-discovery` (correct in both offsets) and `banger-discovery`. **Three of the five it missed are now resolved by inspection (2026-08-23) — see §13.** `banger-live-sync` brackets RTH in both offsets; `zerodte-grade` DRIFTS but is harmless; `zerodte-warm` is immune by construction. Still open: **`nighthawk-edition`, `swing-active-refresh`** | run `cron-dst-audit.mjs --infra=<path>` with blackout-infra attached — inspection cannot see the DEPLOYED schedule |
| U3 | Does `get_nighthawk_outcomes` still deliver its full payload in production? | **Unanswerable right now, and the reason is NOT Night Hawk.** #2480 fixed it once, it recurred 2026-08-22, #2628 is the follow-up. Two probe runs on 2026-08-22 ~23:30 UTC both came back INDETERMINATE, and the second (scoped to one tool, so it outlived its session) showed why: Largo returned its canned fallback — *"I couldn't pull enough live data to answer that"* — instead of calling the tool. **Measured platform-wide, not NH-specific:** the same fallback came back for an SPX-structure question, a flow-tape question, a second NH tool, and even a plain non-data question ("what products does BlackOut offer"), i.e. the fallback's own suggested remedy also fails. So the Largo agent is degraded in production and no Largo-boundary claim about ANY product is verifiable until it recovers | re-run `largo-truncation-probe.mjs` once Largo answers a control question at all. **Also needs a new `--control=`**: the probe's default control is `get_nighthawk_outcomes` itself, and the probe's own header (line 68) predicts that #2480/#2628 make it return COMPLETE, at which point it can no longer prove the instrument |
| U4 | Real board-build p50/p95 during RTH | the 3s never-block ladder means a slow build is invisible as latency — it shows up as an empty board instead | instrument `buildAndPublishBoard`; measure during RTH, not off-hours |
| U5 | How often the never-block ladder actually serves `buildMinimalBoardFallback()` | nothing counts it today | a counter on the fallback branch; an empty board with `discovery_health` all-`ok` is the signature |
| U6 | Live pixel state of `/nighthawk` at desktop + 430 | not measurable off-hours; a selector assertion is not a UI test | `proxy-browser.cjs` from the repo root during RTH |
| ~~U7~~ | ~~`feature_vector` is persisted and consumed by nothing~~ **— WRONG, and it was inherited.** The claim came from `NIGHTHAWK-DATA-PROVENANCE.md` §7G (2026-07-25); this map repeated it as an open UNKNOWN | **CLOSED 2026-08-23.** It has at least four readers: `largo/play-similarity.ts` (this lane's own Largo boundary, casts it to `SetupFeatureVector`), `calibration-rail-graduation.ts` (reads pinned `reg_structure`), `feature-store.ts`, and `thesis-health.ts` (compares the pinned commit structure against live) | nothing — closed. The lesson is the one §9 already makes: a stale doc's absence-claim is not evidence, and this map inherited one without re-checking it |

---

## 11. Deployed values — rule 8 applied

`_COMMON.md` rule 8 (added 2026-08-22, #2634): *the deployed value is the fact, the code default is
a decoy.* Every env-tunable number in §2 and §5 above was therefore checked against what production
actually ships, read read-only from `blackout-production/app/env` via boto3 (98 keys in the blob;
only non-secret Night Hawk flag names were read, never the full blob, never a credential).

### The good news: §2 and §5 are measured, not assumed

**None of the twelve env-tunables this map asserts are overridden in production** — so for these,
the code default *is* the deployed fact:

`ZERODTE_BOARD_MAX_BLOCK_MS` · `ZERODTE_G4_FAIL_CLOSED` · `ZERODTE_G7_FAIL_CLOSED` ·
`ZERODTE_G11_FAIL_CLOSED` · `ZERODTE_G11_HALT_FAIL_CLOSED` · `ZERODTE_EXIT_MODE` ·
`ZERODTE_WHOLE_MARKET` · `ZERODTE_SRC_BREAKOUT` · `ZERODTE_SRC_PIN` · `ZERODTE_CONDOR` ·
`ZERODTE_CONFLUENCE_MIN` · `BREAKOUT_MAX_CANDIDATES` — all **NOT SET**.

In particular the 3s never-block ceiling and all four Phase-0 firewall kill-switches really are at
their documented defaults in production. That is now a measurement.

### What IS deployed — six flags, two of which need attention

| Key | Deployed | What it does |
|---|---|---|
| `NIGHTHAWK_EDITION_ENABLED` | `"1"` | evening edition on |
| `ZERODTE_CALIBRATION_RAIL_PRIORS` | `"shadow"` | shadow rail priors blended into market-state merge rank |
| `ZERODTE_CALIBRATION_PRIOR_BLEND` | `"0.35"` | the blend factor `calibrationPriorBlendFactor()` returns at trace step 1 |
| `BREAKOUT_INTRADAY_REFRESH` | `"1"` | swing-discovery intraday refresh |
| `PIN_TEMPORAL_STABILITY` | `"1"` | **see NH-1** |
| `BREAKOUT_DYNAMIC_CAP` | `"1"` | **see NH-2 — this key is never read** |

The two calibration flags matter for the trace: step 1's `loadShadowRailPriors()` /
`calibrationPriorBlendFactor()` are **live in production at a 0.35 blend**, not dormant. Any
statement that rail priors are "shadow-only, not affecting the board" is wrong — they re-sort the
merge rank.

### NH-1 — `PIN_TEMPORAL_STABILITY` is ENFORCED in production on a measurement that was never completed

**Severity: material. Not flattering-direction, but it silently suppresses plays.**

- `pin-temporal-stability.ts:2` states the flag is **"DEFAULT-OFF … until offline measurement
  warrants enforcement."**
- `INTENTIONAL-DESIGN.md` item #3 (single-snapshot PIN wall test) names
  `scripts/audit/wall-temporal-stability.mjs` as the measurement that would justify enforcing it.
- `CLAUDE.md` records that run's outcome: the poller was built and smoke-tested live, but **RTH was
  closed with no reusable capture, so the stability measurement is still INSUFFICIENT DATA.**
- Production nonetheless ships `PIN_TEMPORAL_STABILITY="1"`.
- It is wired and it **blocks**: `pin-discovery.ts:234-238` calls `pinPassesTemporalStabilityGate`
  and `return null`s the candidate on failure — the PIN never reaches the merge, the gate stack, or
  the ledger. It requires `PIN_TEMPORAL_MIN_SNAPS = 2` snapshots bracketing within
  `PIN_TEMPORAL_WALL_TOL = 0.5%`.

So a hard suppression rule that the design record calls parked-pending-evidence is live, and the
evidence it was parked on does not exist. **This is not a claim that the gate is wrong** — it may
well be correct, and fail-closed is the house default. The finding is that *nobody can currently
say either way*, and the code comment tells a reader it is off.

Closing it needs the measurement, not a code change: capture GEX wall snapshots across one RTH
session with `scripts/audit/gex-wall-snapshot-poll.mjs`, then run `wall-temporal-stability.mjs`
against them. **Until then, the honest status of INTENTIONAL-DESIGN item #3 is "enforced,
unmeasured", not "parked".**

### NH-2 — `BREAKOUT_DYNAMIC_CAP="1"` was a key nothing reads — **FIXED**

Production sets `BREAKOUT_DYNAMIC_CAP="1"`. The only env name `breakout-cap.ts` ever reads is
**`BREAKOUT_DYNAMIC_CAP_DISABLED`** (`breakout-cap.ts:47,64`). There is no read of the bare key
anywhere in `src/`.

The dynamic cap is on regardless — `disabled` resolves false when `BREAKOUT_DYNAMIC_CAP_DISABLED`
is unset — so **the deployed behaviour matched the evident intent by coincidence, not by the flag.**
The trap was the inverse operation: turning the dynamic cap OFF with `BREAKOUT_DYNAMIC_CAP="0"`
changed nothing, silently, on the emergency revert path.

**Fixed** by `resolveBreakoutDynamicCapDisabled(env)`, which honours both names and is read at CALL
time rather than module-eval, so a deploy-time value is actually consulted. Precedence is
deliberate: **`BREAKOUT_DYNAMIC_CAP_DISABLED` wins outright**, because a stale enable flag in the
deploy config must never defeat someone actively reverting mid-incident. Behaviour is unchanged for
every value deployed today, which the tests pin explicitly.

**Not closed until live-validated** — this is a config-path change, so it is only really done once
`BREAKOUT_DYNAMIC_CAP=0` is observed reverting to the static floor on production, or the key is
removed from the deploy. FINDINGS entry carries the same status.

---

## 12. Cron DST exposure — inspected 2026-08-23

Closes three of the five NH crons `cron-dst-audit.mjs` had not reported on (U2). **This is code
inspection against `cron-registry.ts`, which is a MIRROR of the deployed EventBridge manifest** — it
cannot see what production actually fires, so each verdict below is "correct as written", not
"verified deployed". The real audit still needs `blackout-infra` attached.

| Cron | Registry UTC | Under EDT | Under EST | Verdict |
|---|---|---|---|---|
| `banger-live-sync` | `*/5 11-21 * * 1-5` | 07:00–17:00 ET | 06:00–16:00 ET | **CORRECT** — a wide band that brackets RTH in *both* offsets, the audit's own "not drift" discrimination |
| `zerodte-grade` | `*/15 20-22 * * 1-5` | 16:00–18:45 ET | **15:00–17:45 ET** | **DRIFTS, but harmless — see below** |
| `zerodte-warm` | `market_hours_only` | — | — | **IMMUNE by construction — see below** |
| `nighthawk-edition` | — | — | — | **UNKNOWN**, still open |
| `swing-active-refresh` | — | — | — | **UNKNOWN**, still open |

### `zerodte-grade` — the near-miss worth reading

The chain looks damning, and was investigated as a suspected P1 before being cleared:

- the schedule genuinely drifts — under EST four fires land at or **before** the 16:00 close;
- `/api/cron/zerodte-grade/route.ts` has **no ET gate**; it calls `gradeZeroDteLedger(force: true)`
  unconditionally;
- grading is **terminal** — `gradeZeroDteSetupRow` stamps `graded_at`, which removes the row from
  every future pass ("everything must land in this one try");
- `gradePlanFromBars` (`plan.ts:405-433`) never sees a bar past the time stop on an incomplete
  session, so it falls through to `time_stop` priced at **the last available bar**.

Composed, that stamps a permanent wrong grade — in the flattering *and* unflattering direction — for
roughly five months a year.

**It does not happen, because `fetchUngradedZeroDteRows` (`db.ts:6465`) selects
`WHERE graded_at IS NULL AND session_date < $1::date`.** The grader never touches the current
session, so its bars are always complete.

> **The safety lives outside the schedule, and that is the finding.** `zerodte-grade` is correct
> only because of a `WHERE` clause in a different file. A plausible future change — "grade same-day
> plays faster" — would silently arm a money-adjacent defect with **no schedule edit to review**.
> The coupling is now commented at the query.

### `zerodte-warm` — immune for a structurally better reason

`warmZeroDteBoard` does not self-gate on ET either, but it cannot commit off-hours regardless of
when its cron fires: **G-2 (opening window) and G-14 (late afternoon) compute ET wall-clock
in-process** via `etNowParts()`, evaluated at scan time.

That is the pattern worth generalising across the fleet:

**A gate that derives its own ET is immune to cron drift. A job whose correctness depends on *when
it was invoked* is not.** `zerodte-warm` is the first kind. `zerodte-grade` is the second kind that
happens to be saved by an unrelated query predicate — which is a weaker guarantee wearing the same
green badge.

---

## 13. How to use this file

- **Before any Night Hawk fix**, check §9 — three of the most-cited open defects are already fixed,
  and a PR that "fixes" them again is noise.
- **Before any freshness claim**, check §2 — three lanes, three bounds. "Stale" without naming the
  lane is not a report.
- **Before any win-rate claim**, check §7 — as-managed vs mechanical, and the condor's opposite
  skew.
- **Before calling the board empty**, check §4.3 — `discovery_health` distinguishes a quiet market
  from a lane that could not see.
- **Before quoting any env-tunable as behaviour**, check §11 — and re-read it against
  `blackout-production/app/env` rather than trusting this file, because a deploy can change it
  without a commit. Two flags there (NH-1, NH-2) are open items, not settled facts.

When this file and the code disagree, **the code wins and this file is a bug.**
