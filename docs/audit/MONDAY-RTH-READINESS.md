# Monday RTH Readiness — 0DTE play-generation BLOCKER trace

**What this is.** A stage-by-stage trace of the ENTIRE path from raw upstream data → a committed
0DTE play on the Night Hawk board, enumerating every condition that can BLOCK a play and assessing
its state for the **Monday 2026-07-27** regular-trading-hours open. Built 2026-07-25 from the live
code (`src/lib/zerodte/**`, `src/lib/ws/**`, `src/features/nighthawk/**`, `deploy/**`) + a live
run of `npm run validate:e2e` (the new `zerodte-e2e-suite.mjs`) + `docs/audit/NIGHTHAWK-DATA-PROVENANCE.md`.

**Verdict up top:** see §Top-line verdict. **State legend:** 🟢 GREEN clear · 🟡 AMBER needs-a-live-look
· 🔴 RED blocking now.

**Calendar check (no edge):** Monday 2026-07-27 is a **normal full trading day**. Independence Day
2026 was observed Fri 2026-07-03; the next holiday is Labor Day Mon 2026-09-07. No half-day, no
holiday-shortened week. DTE math is ET-anchored calendar days — a 2026-07-27 expiry resolves to DTE 0
Monday, so 0DTE flow + chains behave normally. **No timezone/expiry-calendar edge blocks the session.**

---

## Live upstream smoke (from `npm run validate:e2e`, 2026-07-25 off-hours)

| Section | Verdict | Evidence |
|---|---|---|
| **API-POLYGON** | 🟡 AMBER (all required GREEN) | marketstatus, indices (SPX 7411.98 / **VIX 18.58**), SPY prev 738.93, VIX minute range, **grouped-daily 12,410 stocks**, option chain (greeks `{}` off-hours = expected), reference contracts (exp 2026-07-27), unified OCC snapshot — all 200. `v3/trades` empty + greeks empty are the only ambers, both off-hours-normal. |
| **API-UW** | 🟢 GREEN | flow-alerts (25 rows), SPY per-stock flow, **SPX spot-exposures/strike GEX (50 rows)**, greek-exposure (791), screener, darkpool, net-flow/expiry, earnings pre/afterhours — all 200. |
| **INFRA (RDS+Redis)** | ⚪ SKIPPED | Sandbox AWS creds are placeholders → skipped by design; run with valid `AWS_ACCESS_KEY_ID/SECRET` to assert RDS `blackout-production-postgres` available/Multi-AZ + Redis `blackout-production-redis-rg` available/failover. |
| **DATA-PATH** | 🟢 GREEN | `/board` served (Redis snapshot path live, snapshot fresh), `/record` served **111 graded rows** (Postgres read path live). |

**Read-through:** every REQUIRED external upstream the pipeline depends on is live and correctly
shaped right now. The empty-greeks / empty-trades ambers are the off-hours state and clear at the open.

---

## Stage-by-stage blocker trace

### Stage 0 — INGESTION (UW socket → Postgres `flow_alerts`; the leader lock; boot)

| Item | Condition that blocks | State | Notes |
|---|---|---|---|
| **UW WS leader lock** | Only the Redis leader replica opens the UW socket (`uw:ws:leader`, SETNX, 25s TTL, 10s renew, fenced token — `ws/uw-socket.ts:162,194,217`). If the leader stalls past TTL a standby takes over within one 10s tick. | 🟡 verify at open | **Failure mode:** on **multi-replica ingest** (`REPLICA_COUNT>1`) a **Redis outage fails CLOSED** — every replica stands down, NO upstream WS opens, flow ingestion stalls (`ws/leader-lock-shared.ts:25-27`). The market-worker default is single-replica (`deploy/market-worker.mjs:36`) → fails OPEN. Watch: board.setups staying 0 with a live tape after 10:00. |
| **`EAGER_DATA_SOCKETS` / boot** | Market-worker sets `EAGER_DATA_SOCKETS=1`, GETs `/api/worker/boot` → `ensureDataSockets()` (`init-data-sockets.ts:45`); supervisor SIGTERMs the child if boot fails 30×. Web tasks lazy-boot on first `/api/market/*` hit. | 🟢 clear | Deploy well before the open so the leader has re-acquired (see D2 in provenance). |
| **`flow_alerts` table warm (RDS WRITE path)** | Scan reads flow from **Postgres, not the live socket** (`fetchRecentFlows`, `db.ts:2121`): intraday `since_hours:7, min_premium:150k, max_dte:1`; multi-day `since_hours:120, min_premium:250k`. If the worker isn't writing rows (socket down / leader deadlock / RDS write stalled), the scan reads an empty/stale table → **no candidates**. | 🟡 verify at open | **RDS is not reachable via raw TCP from the sandbox** — verify indirectly: `/board` ledger + setups populating after 10:00, and the `/record` Postgres read path (already GREEN). Detect at 09:32: setups should start non-zero once flow prints post-open. |

### Stage 1 — DISCOVERY ×3 (minimum condition to emit ≥1 candidate)

| Source | Min condition for ≥1 candidate | State | Blocker detail |
|---|---|---|---|
| **FLOW** (`deriveZeroDteSetups`, `board.ts:608`, always-on) | One aggregated ticker passing ALL evidence gates: `dte∈[0,1]`, **gross ≥ $750k** (`SETUP_MIN_GROSS`), aggression share ≥ 0.3, side dominance ≥ 0.65, moneyness within ITM −2% / OTM +12% (needs a real underlying price else `no_underlying_price` fail-closed). | 🟢 plausibly met | On a normal tape multiple names clear $750k gross same-day 0DTE flow. Multi-day accumulation is **evidence-only, non-gating** — it never blocks. **Starvation risk low.** |
| **BREAKOUT** (`screenBreakoutMovers`, `candidates.ts:440`) | A grouped-daily mover with price $5–400, volume ≥ 1M, intraday gain ≥ 5%, close-strength ≥ 0.5. **Corrected 2026-08-06 — this row previously said "top-6 by $-volume (`BREAKOUT_MAX_CANDIDATES=6`)", which has been wrong for weeks.** Actual: a **400-name pool per side**, re-ranked by **momentum quality** (`rankMoversForChainFetch`: long = `gain × close_strength`), then a **dynamic cap** `clamp(ceil((long+short qualifying) × 0.30), 40, 100)` (`breakout-cap.ts`); `BREAKOUT_MAX_CANDIDATES=40` is now the FLOOR, `BREAKOUT_MAX_CANDIDATES_CEILING=100` the ceiling. In practice the cap resolves to the ceiling (100) on most sessions. RTH-only [9:30,15:00). | 🟡 flag-gated | **Emits ZERO unless `ZERODTE_WHOLE_MARKET` + `ZERODTE_SRC_BREAKOUT` are set** (`scan.ts:295`). On a quiet tape the 5%-gain filter can genuinely starve it — that's by design (no forced plays). The cap does not block emission. Recall/leakiness evidence: see `INTENTIONAL-DESIGN.md` §4 (the pre-2026-08-06 recall numbers were measured against the wrong ordering and are void). |
| **PIN** (`evaluatePinRegime`, `pin-source.ts`) | A curated liquid name with both GEX walls ≥ 4% dominance, band width 0.4–6%, off-center 0.25–0.9, long-gamma posture. Universe = 14 names, cap 8, RTH-only. | 🟡 flag-gated | **Emits ZERO unless `ZERODTE_WHOLE_MARKET` + `ZERODTE_SRC_PIN` are set** (`scan.ts:333`). GEX walls are NOT cold at open (prior-settle OI) — if flagged on, a pin usually forms on SPX/QQQ. |

**Critical config note:** if `ZERODTE_WHOLE_MARKET` / `ZERODTE_SRC_BREAKOUT` / `ZERODTE_SRC_PIN` are
unset in the market-worker task def, **discovery is FLOW-only**. The INFRA section of
`validate:e2e` reads these flags off the ECS task def when AWS creds are present — run it with creds
pre-open to confirm the intended discovery breadth.

### Stage 2 — GATES G-1..G-12 + fail-closed firewall (`gates.ts:323`)

| Gate | Blocks when | Fail-closed on missing data? | Monday state |
|---|---|---|---|
| **G-1** tape alignment | direction fights SPY bias; stale bias > 15min | **YES** → `no_market_bias` | 🟢 SPY bias warms by ~09:35; holds closed while warming (safe). VIX/SPY live now. |
| **G-2** opening window | any fresh commit **before 10:00 ET** | clock-based | 🟢 **expected** — empty board 09:30–10:00 is BY DESIGN, not a fault. |
| **G-3** score floor | edge score < 65 | n/a | 🟢 normal. |
| **G-4** VIX regime | VIX ≥17 needs score ≥75 (≥65 tape-aligned); ≥20 index/ETF only | **YES** if `vixUnavailable` (`ZERODTE_G4_FAIL_CLOSED` default ON) | 🟢 **VIX live at 18.58** (elevated band 17–20). Present VIX → G-4 passes tape-aligned/high-score names; does NOT hold everything. Watch if VIX spikes ≥20 (index/ETF-only). |
| **G-5** governor | see Stage 3 | **YES** → `gate_context_unavailable` on null governor | 🟢 governor context reads Postgres ledger + Redis stops (both live). |
| **G-6** cross-system conflict | opposing Slayer/NightHawk on correlated ticker, score <80 | only on present conflict | 🟢 rare at open. |
| **G-7** macro | CPI/FOMC/NFP window | **YES** if `macroUnavailable` (`ZERODTE_G7_FAIL_CLOSED` default ON) | 🟢 no high-impact macro scheduled Mon 07-27 pre-open; calendar has a curated fallback so it rarely fails closed. Confirm no 08:30 ET print. |
| **G-8/G-9** plan quality | chase >35% / spread >15% / malformed quote | **YES** → `plan_no_quote` on null plan | 🟢 chain + quotes live; only blocks genuinely bad books. |
| **G-10** intraday conflict | name VWAP/5m opposes direction | only when true | 🟢 normal. |
| **G-11** halt + earnings | active halt, or earnings-today name | **YES ×3**: halt-feed-stale (`ZERODTE_G11_HALT_FAIL_CLOSED` default ON), earnings-unavailable (`ZERODTE_G11_FAIL_CLOSED` default ON) | 🟡 **the real watch item** — the halt store + earnings snapshot **fail OPEN today** (D1/D2 in provenance: an empty map is read as "nothing to report"). The fail-closed *helpers* exist but the board opts out of the halt one. A board that PRINTS while these feeds are cold is the anomaly, not an empty board. |
| **G-12** confluence floor | confirmations < floor (1 post-open, **2 in [10:00,10:45)**) | **NO — fails OPEN** on null read | 🟡 the early window demands the full 2 confirmations (VWAP-side + market-aligned) — the first commits realistically land ≥10:00, and possibly not until a name is both VWAP- and SPY-aligned. |
| **WS-21** source-health | commit only if source HEALTHY | DEFAULT-OFF (`ZERODTE_REQUIRE_HEALTHY_SOURCE=1` to arm) | 🟢 no-op unless armed. |

**Env kill-switch snapshot (defaults):** `ZERODTE_G4_FAIL_CLOSED`, `ZERODTE_G7_FAIL_CLOSED`,
`ZERODTE_G11_FAIL_CLOSED` (earnings), `ZERODTE_G11_HALT_FAIL_CLOSED` all default **ON** (`!= "0"`).
`ZERODTE_REQUIRE_HEALTHY_SOURCE` + `ZERODTE_CONDOR` default **OFF**. These are read live off the ECS
task def by `validate:e2e`'s INFRA section (with AWS creds) — none is set to a value that would
hold every play on a day with live VIX/macro/flow.

### Stage 3 — GOVERNOR (`governor.ts:394`)

| Halt | Freezes commits when | Monday state |
|---|---|---|
| Max concurrent | open + committed-this-cycle ≥ **3** (`GOVERNOR_MAX_CONCURRENT_PLANS`) | 🟢 zero open at the fresh open — no freeze. |
| Session stops | ≥ **3** hard-stop halts (`GOVERNOR_MAX_SESSION_STOPS`) | 🟢 resets each session. |
| Realized-loss halt | ≥ **3** losers OR cumulative ≤ **−120%** (`GOVERNOR_LOSS_HALT_COUNT` / `_SESSION_LOSS_FLOOR_PCT`) | 🟢 clean slate at open; only a bad early run trips it. |
| Re-entry lock | same-direction re-entry within **20min** of a stop | 🟢 n/a at open. |
| Correlated conflict | opposing open plan in a correlation group (SPY/QQQ/IWM/SPX/…) | 🟢 n/a with zero open. |

State derives from Postgres `zerodte_setup_log` (replica-safe) + Redis stop timestamps — **both live**
(DATA-PATH GREEN). Losing Redis only softens the timed re-entry lock; never un-halts a hard stop.

### Stage 4 — CORTEX veto + confluence-2 commit

- **Cortex** (`cortex-gate.ts:132`) blocks on any VETO first, then NET_NEGATIVE (score<0), then
  thin-evidence (< 3 answering sources needs score ≥ 0.5). Fresh 0DTE commits pass
  `failClosedOnVetoBlind:true` → if BOTH veto sources (gex-walls + flow-quality) are blind → HOLD.
  A **total** Cortex outage → ABSTAIN (commits on hard gates alone — deliberate; never throws).
- **Could veto + confluence-2 reject everything on a normal day?** 🟡 Possible in the early window
  (10:00–10:45) when 2 confirmations are required AND a live GEX wall vetoes a long into it — but
  this is the negative-play firewall working, not a fault. Cortex veto is stateless (recomputes each
  pass) so it can flicker (see veto-flicker-rate finding); a veto that clears within a few passes lets
  the next scan commit. Net: **not expected to reject *everything*** on a tape with real flow.

### Stage 5 — COMMIT → LEDGER → BOARD SNAPSHOT → render

- Snapshot key **`zerodte:board:snapshot:v1`**, TTL 60s, SWR soft-age 5s, hard-age 30s, cross-replica
  build lock 20s (`platform/zerodte-service.ts:167-184`). Cron `zerodte-warm` runs
  `warmZeroDteBoard()` + `refreshZeroDteBoardSnapshot()` every **5 min** weekdays (`*/5 11-21 * * 1-5`
  UTC); sub-5min gaps healed by the in-app `rth-warm-leader` (4-min heal). Members read via SWR REST
  (`/board`, `no-store`) + SSE for live marks.
- **REDIS WRITE path to watch:** worker → board snapshot (`zerodte:board:snapshot:v1`) + option marks
  (`nw:optmark:{OCC}`). If the warm cron is cold or the Redis write stalls, members see the **last**
  snapshot until the next tick. Detect at 09:32: snapshot age (as_of) should be dropping tick-to-tick;
  `/board` served with a recent as_of = Redis write path live (currently GREEN, fresh).

### Stage 6 — RATE-LIMIT budgets

- **UW ~2 rps + 12-call hunt budget** (`uw-hunt-budget.ts`). Uncached per-candidate dossier datums
  (oi-change, term-structure, realized-vol, skew, greek-flow, insider, institution) are what the
  budget bounds. 🟡 **Too many candidate tickers can starve the hunt** — but a starved dossier
  **degrades to cached/empty, it does NOT block a commit** (the hard-gate spine runs on Polygon, which
  is effectively uncapped on Advanced). Confirm the `uw-cache-refresh` cron is firing pre-open so
  market-wide/dossier are pre-warmed rather than fetched live under budget.
- **Polygon** effectively uncapped — the numeric spine (spot/chain/greeks/VIX/grading) is resilient.

---

## Prioritized Monday-open blocker checklist

| # | Possible blocker | Symptom at 09:32–10:05 | How to detect live | One-line mitigation | State |
|---|---|---|---|---|---|
| 1 | **G-2 pre-10:00 lockout** (by design) | empty board 09:30–10:00 | expected; ignore before 10:00 ET | none — wait for 10:00 | 🟢 |
| 2 | **Discovery flags off** → FLOW-only | only FLOW-origin setups, never BREAKOUT/PIN | `validate:e2e` INFRA (AWS creds) reads `ZERODTE_WHOLE_MARKET/_SRC_BREAKOUT/_SRC_PIN` off task def | set the flags on the market-worker task def + redeploy | 🟡 |
| 3 | **UW leader fails CLOSED on multi-replica + Redis blip** → flow ingestion stalls | board.setups stays 0 with a live tape after 10:00 | `/board` setups=0 while UW flow-alerts REST returns rows (validate:e2e API-UW GREEN) | ensure single ingest replica OR Redis healthy; restart worker to re-elect leader | 🟡 |
| 4 | **`flow_alerts` RDS write lag** → scan reads empty table | setups=0, ledger=0 despite live flow REST | `/record` (Postgres read) GREEN but `/board` setups empty → write-side lag | verify worker writing; INFRA section asserts RDS available/Multi-AZ | 🟡 |
| 5 | **Redis board-snapshot cron cold** → stale board | `/board` as_of not advancing tick-to-tick | snapshot age (as_of) frozen in `validate:e2e` DATA-PATH | confirm `zerodte-warm` cron firing; `rth-warm-leader` heals sub-5min | 🟢 (fresh now) |
| 6 | **G-4 VIX spike ≥20** → index/ETF-only | single-name commits vanish, only SPY/QQQ | live VIX via indices snapshot (18.58 now) | none needed (correct de-risk); watch the tape | 🟢 |
| 7 | **G-7 macro fail-closed** → whole-session hold | board empty after 10:00 with reason `macro_unavailable`/high-impact window | reason codes on held setups; check the calendar for an 08:30 print | confirm no high-impact macro Mon; kill-switch `ZERODTE_G7_FAIL_CLOSED=0` only if feed is the fault | 🟢 |
| 8 | **G-11 board PRINTS while halt/earnings feed COLD** (fail-OPEN anomaly) | a fresh 0DTE on a halted or earnings-today name | cross-check any committed name vs UW earnings pre/afterhours (validate:e2e) + a halt source | D1/D2 remediation (fail-closed earnings/halt) — deploy-gated; until then, eyeball committed names | 🟡 |
| 9 | **G-12 early-window 2-confluence** → slow first commit | nothing 10:00–10:45 despite candidates | held setups show confluence < 2 | none — by design; commits accelerate after 10:45 | 🟡 |
| 10 | **Governor freeze** after a rough early run | commits stop mid-session | reason `governor_*` (3 stops / 3 losers / −120% / 3 concurrent) | expected risk control; resets next session | 🟢 |
| 11 | **UW hunt-budget starvation** on a huge candidate pool | dossier fields empty, but commits still flow | UW breaker/429s; dossier nulls | Polygon spine still commits; ensure `uw-cache-refresh` cron warm | 🟢 |
| 12 | **Cortex veto-blind HOLD** | fresh setups held with `veto_blind` | both gex-walls + flow-quality absent | GEX is live (validate:e2e GEX GREEN) → veto-blind unlikely | 🟢 |

---

## Top-line verdict

**Are plays expected to generate Monday? YES — conditional on the two config/infra confirmations below.**

Every REQUIRED upstream is live and correctly shaped right now (Polygon spine + UW flow + GEX all
200; VIX 18.58, grouped-daily 12,410 stocks). The Postgres read path and Redis snapshot path are
both GREEN through the app. On a normal tape, FLOW discovery alone clears the $750k-gross /
dominance / aggression bar on multiple same-day names, and the hard-gate stack passes with live
VIX/macro/flow — no gate is thresholded to hold *every* play on a live session.

**The three things to watch at the open (in order):**
1. **Discovery breadth** — confirm `ZERODTE_WHOLE_MARKET` + `ZERODTE_SRC_BREAKOUT` + `ZERODTE_SRC_PIN`
   are set on the market-worker task def (run `validate:e2e` with AWS creds pre-open). If unset,
   discovery is FLOW-only — still generates, but narrower than intended.
2. **Ingestion write path (RDS + leader)** — after 10:00, `/board` setups should go non-zero as flow
   prints. If it stays 0 while UW flow-alerts REST returns rows, suspect the UW WS leader (Redis
   fail-closed on multi-replica) or an `flow_alerts` write lag — restart the worker to re-elect.
3. **The fail-OPEN anomaly (G-11)** — the danger is NOT an empty board (that's normal pre-10:00 and
   under fail-closed gates); it's a board that **prints while the halt/earnings feed is cold**.
   Cross-check any committed name against the live earnings feed.

Nothing in the code or the live smoke is currently RED. The board should produce plays from ~10:00 ET
onward, subject to the early-window 2-confluence requirement (10:00–10:45) and the normal fail-closed
holds when a specific feed degrades.
