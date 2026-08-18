# Night Hawk 0DTE Day Trades — Deep Dive Audit

**Date:** 2026-08-18 (live RTH probe ~12:30 PM ET)  
**Scope:** Full pipeline — discovery → scoring → gates → Cortex → commit → marks → exit → UI  
**Audience:** Product + engineering; no code changes in this PR — investigation + prioritized fix backlog only  
**Verdict:** The engine is **not “broken” in the sense of dead infra**, but **play quality is structurally weak** today: negative-EV origin bands on the graded ledger, a FLOW-only live board when whole-market rails are empty, aggressive gating that hides candidates from the default UI filter, and several known fail-open / unreachable-code bugs that leak low-edge commits on volatile days.

---

## 1. Executive summary — why it *feels* broken

Members open **Night Hawk → 0DTE (Command Deck)** expecting actionable day trades. What they often see instead:

| Symptom | What’s actually happening |
|--------|---------------------------|
| “Board is empty / only junk” | Default filter is **OPEN** when any working play exists; with **0 open** today, filter falls to **WATCH** — but only **5 setups** on board, **4/5 BLOCKED** (score/confluence/accumulation). |
| “High-score names never trade” | **G-3 score floor 65** blocked **192** gate events today; QQQ 60, META 61, MSFT 35, AMZN 44 all BLOCKED. |
| “Whole-market scanner does nothing” | **BREAKOUT** lane: `empty_market` (0 setups). **PIN** lane: `ok` but 0 qualifiers. Board is **FLOW-only**. |
| “Plays that do commit lose” | Graded ledger: **BREAKOUT −12% avg PnL** (n=70); **score 85+ → 25% WR, −20% avg** (non-monotonic score). |
| “Condor / pin never shows up” | PIN discovery ran but produced 0; condor geometry exists on setups but **no live CONDOR commit** today. |

**Bottom line:** The system is doing what it was designed to do — **fail-closed, calibration-first, confluence-gated** — but that produces a **thin, FLOW-heavy, negatively calibrated** tape unless BREAKOUT/PIN rails are hot. The UX then **hides** most of the remaining signal behind filters and BLOCKED/WATCH semantics.

---

## 2. Live evidence (2026-08-18 RTH)

Commands run from cloud agent against production:

```bash
node --import tsx scripts/audit/zerodte-e2e-healthcheck.mjs --json
# + authenticated GET /api/market/zerodte/board + /calibration (cron bearer)
```

### 2.1 Health matrix

| Stage | Verdict | Evidence |
|-------|---------|----------|
| A INFRA | GREEN | Web 8/8, market-worker 1/1, `ZERODTE_WHOLE_MARKET/BREAKOUT/PIN/CONDOR=on` |
| B DISCOVERY | AMBER | 6 FLOW setups; **0 BREAKOUT**, **0 PIN** |
| C COMMIT | GREEN | 4 ledger rows with frozen entry snapshots (prior commits) |
| D MARKS | AMBER | 0 open plays to mark (all CLOSED) |
| E EXIT | GREEN | Lifecycle coherent (4 CLOSED) |
| F CONDOR | AMBER | Geometry wired; no actionable CONDOR this pass |
| G GRADING | AMBER | Today’s 4 closes pending post-close grade pass |

### 2.2 Board snapshot (`as_of` 2026-08-18T16:29:47Z)

```json
{
  "setups": 5,
  "ledger": 4,
  "discovery_health": {
    "BREAKOUT": { "status": "empty_market", "setups": 0 },
    "PIN": { "status": "ok", "setups": 0 }
  },
  "discovery_funnel": {
    "detected_tickers": 46,
    "gate_blocked_events": 297,
    "commit_events": 0,
    "top_gate": "score_floor",
    "top_gate_n": 192
  }
}
```

**Live setup sample:**

| Ticker | Score | Origin | Gate | Top blocks |
|--------|-------|--------|------|------------|
| SPXW | 70 | FLOW | (eligible) | — |
| QQQ | 60 | FLOW | BLOCKED | score_floor, confluence_floor, flow_accumulation_conflict |
| META | 61 | FLOW | BLOCKED | score_floor, flow_accumulation_conflict |
| MSFT | 35 | FLOW | BLOCKED | score_floor, confluence_floor |
| AMZN | 44 | FLOW | BLOCKED | score_floor, flow_accumulation_conflict |

**Today’s closed ledger:** NBIZ, SPXW, ANGX, SNDQ — all CLOSED (small/micro-cap heavy).

### 2.3 Calibration report (graded ledger, ~21 sessions)

**Origin bands (where edge should come from):**

| Origin | n | WR | Avg PnL |
|--------|---|-----|---------|
| FLOW | 13 | 46.2% | **−16.3%** |
| BREAKOUT | 70 | 34.3% | **−12.0%** |
| FLOW+BREAKOUT | 4 | 25.0% | **−19.9%** |
| PIN | 0 | — | — |
| no_origin (legacy) | 8 | 62.5% | +6.8% |

**Score bands (G-3 floor = 65):**

| Band | n | WR | Avg PnL |
|------|---|-----|---------|
| 65–74 | 56 | 41.1% | −11.1% |
| 75–84 | 19 | 42.1% | −2.7% |
| **85+** | 20 | **25.0%** | **−20.3%** |

This matches the design doc warning: **score is not a monotonic EV rank** — high premium / one-sided flow can score 85+ while grading poorly.

---

## 3. Architecture map (member path)

```
EventBridge cron (~2m) → scanZeroDteBoard() → persist → Redis snapshot
                              ↓
Member: GET /api/market/zerodte/board (SWR 1s RTH)
                              ↓
NightHawkFeed → ZeroDteDeck → zeroDteSources() → CommandDeck + PlayTerminal
                              ↓
Marks: SSE /api/market/zerodte/marks/stream (~1s) + REST fallback
```

**Key files:**

| Layer | Path |
|-------|------|
| Scan orchestrator | `src/lib/zerodte/scan.ts` |
| FLOW discovery | `src/lib/zerodte/board.ts` (`deriveZeroDteSetups`) |
| BREAKOUT | `src/lib/zerodte/breakout-discovery.ts`, `breakout-source.ts` |
| PIN / condor | `src/lib/zerodte/pin-discovery.ts`, `iron-condor.ts` |
| Gates G-1..G-14 | `src/lib/zerodte/gates.ts` |
| Cortex | `src/lib/zerodte/cortex-gate.ts` |
| Governor | `src/lib/zerodte/governor.ts` |
| Board API | `src/lib/platform/zerodte-service.ts` |
| UI (live) | `src/features/nighthawk/command-deck/containers.tsx` |
| UI (orphan) | `src/features/nighthawk/components/ZeroDteBoard.tsx` — **not mounted** |

---

## 4. Findings

### 4.1 P0 — Member-visible quality / trust

#### NH-0DTE-P0-1 — Graded ledger shows **negative EV** on primary origins

- **Evidence:** Calibration §2.3 — BREAKOUT n=70 @ −12% avg; FLOW n=13 @ −16.3% avg; score 85+ @ −20.3% avg.
- **Impact:** Commits can be “correct” per gates but **lose money on average** until origin/score bands graduate or get throttled.
- **Root cause:** Firewall shipped calibration-first; origin bands were not yet used to **throttle or resize** weak lanes.
- **Fix direction:** Enable calibration-rail graduation to **down-weight or pause BREAKOUT commits** until WR delta clears; surface origin PnL on desk strip (honest, not hidden).

#### NH-0DTE-P0-2 — Default UI hides the candidate tape

- **Evidence:** `defaultZeroDteStatusFilter()` → OPEN when any working play; else WATCH (`deck-session-ui.ts`). With 0 OPEN today, user must be on WATCH to see blocked candidates — but BLOCKED rows show as **SKIP**, not WATCH.
- **Impact:** Members think scanner is “off” when gates block everything.
- **Fix direction:** RTH default **ALL** or dedicated **“Scanner”** filter; show **discovery_funnel** strip prominently (“192 blocked by score floor today”).

#### NH-0DTE-P0-3 — Whole-market rails frequently **empty** while FLOW carries the board

- **Evidence:** Today BREAKOUT=`empty_market`, PIN=`ok`/0. FINDINGS 2026-08-14 OPEN: roster 84→19 mid-session when BREAKOUT dark.
- **Impact:** Product promise of “whole-market 0DTE” collapses to **whale-flow top-400** — mega-cap saturated, small-cap lottery flow.
- **Fix direction:** (a) Enable `BREAKOUT_INTRADAY_REFRESH=1` in prod after A/B; (b) investigate `empty_market` vs `data_unavailable` — today may be genuine quiet tape OR screen thresholds too tight; (c) member-visible `discovery_health` on deck (already on payload — **not shown in UI**).

---

### 4.2 P1 — Bugs & fail-open holes

#### NH-0DTE-P1-1 — `lateCondorOnly` branch is **dead code**

- **File:** `src/lib/zerodte/pin-discovery.ts:179-180`, `pin-window.ts:12-14`
- **Bug:** `PIN_RTH_CUTOFF_ET_MINUTES` and `PIN_CONDOR_LATE_CUTOFF_ET_MINUTES` are **both 15:30** → `lateCondorOnly` is always false.
- **Impact:** Post-15:30 condor-only window never opens; PIN lane SKIPs after cutoff entirely.
- **Fix:** Set condor late cutoff to e.g. **15:50** (align with session hard exit) or remove dead branch.

#### NH-0DTE-P1-2 — Halt feed import failure → **fail-open**

- **File:** `src/lib/zerodte/scan.ts` (~717) — catch returns `{ feedStale: false }`
- **Impact:** G-11 halt-feed fail-closed never fires on dynamic import throw.
- **Fix:** Return `feedStale: true` on catch when LULD/UW halt enabled.

#### NH-0DTE-P1-3 — Atomic commit fallback skips governor re-count

- **File:** `src/lib/zerodte/scan.ts:1356-1360`
- **Impact:** Rare race can exceed concurrent cap under DB pressure.
- **Fix:** Retry atomic path or block fallback when governor at cap.

#### NH-0DTE-P1-4 — Score **non-monotonicity** not gated

- **Evidence:** Score 85+ worst band on calibration; design doc §0 “75–84 vs 65–74”.
- **Impact:** G-3 floor 65 admits trades that **look** strong but grade worst.
- **Fix direction:** Add **score ceiling guard** or aggression/moneyness sub-floor for 85+ until recalibrated; or cap score contribution from raw premium tiers.

#### NH-0DTE-P1-5 — G-10 intraday conflict **demoted to score-only**

- **File:** `gates.ts` — `intraday_conflict` never emitted
- **Impact:** VWAP/trend conflict no longer hard-blocks; contradicts research on counter-tape entries (F-3: 0/5 longs on down day).
- **Fix direction:** Re-enable as gate for single-names OR fold into confluence with higher floor.

---

### 4.3 P2 — Data & discovery gaps

| ID | Issue | Detail |
|----|-------|--------|
| NH-0DTE-P2-1 | FLOW-only blind spot | Top-400 premium cap misses momentum without whale prints (`0DTE-UNIFICATION-DESIGN.md` §0). |
| NH-0DTE-P2-2 | BREAKOUT intraday refresh OFF | `BREAKOUT_INTRADAY_REFRESH` default false — grouped-daily bar can lag intraday movers. |
| NH-0DTE-P2-3 | PIN temporal stability OFF | Single-snapshot walls allowed — pin fades may be noisy. |
| NH-0DTE-P2-4 | Dossier/Cortex top-12 only | Ranks 13–48 lack dossier → Cortex ABSTAIN / veto-blind more often. |
| NH-0DTE-P2-5 | Marks/quotes caps | 100 OCC mark cap, 60 ticker quote cap — large boards degrade silently. |
| NH-0DTE-P2-6 | `flow_accumulation_conflict` | Blocks META/AMZN/QQQ today — multi-day flow opposes direction (often correct, but opaque to member). |
| NH-0DTE-P2-7 | Earnings on board tickers | G-11 uses grid earnings; Benzinga primary path exists elsewhere but 0DTE still uses `readGridEarnings`. |

---

### 4.4 P2 — UX / product gaps

| Gap | Recommendation |
|-----|----------------|
| No SSR board seed | Re-enable selective seed (`nighthawk-seed-props.ts`) for first paint |
| SKIP vs WATCH confusion | Label gate-blocked rows “Blocked — score floor” with top reason |
| discovery_health not rendered | Show per-lane status chip (FLOW/BREAKOUT/PIN) |
| discovery_funnel buried | Top strip: “192 score blocks · 0 commits today” |
| ZeroDteBoard orphaned | Remove or wire as alternate density view |
| Track record not linked | Link `/track-record` 0DTE tab from deck header |
| “Why this play” on commit | Surface `entry_context.cortex` + origin + confluence count on terminal |

---

### 4.5 Intentional / calibration-first (do NOT “fix” without ledger proof)

These are **by design** until graded evidence says otherwise:

- G-12 confluence ≥2 (E3: +15.9% EV at 2-conf)
- G-2 10:00 unlock (user directive; 9:45 worst in E2)
- Cortex veto-blind fail-closed on fresh commits
- Iron condor negative skew (98.7% close WR, 18.7% breach)
- Governor 3-stop session halt
- Scale-out vs ratchet (hold beats ratchet on full sample — see `0DTE-RESEARCH.md` E5)

---

## 5. Research-backed levers (highest ROI)

From `docs/audit/0DTE-RESEARCH.md` and `0DTE-UNIFICATION-DESIGN.md`:

1. **Confluence ≥2 as gate** — already shipped (G-12); ensure UI explains why 60-score QQQ is blocked.
2. **Throttle BREAKOUT origin** until calibration band clears n≥10 / delta≥15.
3. **Far-OTM cap + aggression floor** — reduce 85+ score false conviction.
4. **Enable intraday BREAKOUT refresh** — measure recall vs chain budget (`discovery-recall-probe.mjs`).
5. **PIN + condor post-cutoff** — fix dead `lateCondorOnly` so range-day engine can run.
6. **Origin-aware merge policy** — FLOW-first vs evidence-weighted (INTENTIONAL-DESIGN #1); run `merge-precedence-ab.mjs` on disagreements.

---

## 6. Measurement plan (next RTH sessions)

| Probe | When | Pass criteria |
|-------|------|---------------|
| `npm run healthcheck:0dte` | Daily 09:35 ET | B DISCOVERY not all-AMBER with FLOW-only + empty BREAKOUT |
| Board poll + `discovery_health` | Hourly RTH | BREAKOUT status `ok` OR honest `data_unavailable`, not silent empty |
| `npm run sim:0dte` | Pre/post gate change | Funnel trace documented |
| `discovery-recall-probe.mjs` | Weekly | Dropped winners ≤ kept cohort |
| `firewall-rth-replay.mjs` | After gate PR | Net session PnL delta ≥ 0 |
| Calibration origin bands | Weekly | No origin band < −10% avg with n≥20 without throttle |

**Confirm FINDINGS 2026-08-14 OPEN:** When `setups.length < 40`, log `discovery_health.BREAKOUT.status`.

---

## 7. Recommended fix sequence (separate PRs)

| Priority | PR theme | Est. blast |
|----------|----------|------------|
| 1 | **Desk UX:** show discovery_health + funnel + gate reason on SKIP rows | UI only |
| 2 | **Fix `lateCondorOnly`** + pin-window tests | PIN/condor |
| 3 | **Calibration throttle:** pause BREAKOUT commits when band < −10% avg & n≥20 | scan.ts + graduation |
| 4 | **Score 85+ guard** (aggression + moneyness) | board.ts + gates |
| 5 | **BREAKOUT_INTRADAY_REFRESH** prod A/B | env + metrics |
| 6 | **Halt feed fail-closed** on import error | scan.ts one-liner |
| 7 | **Benzinga earnings** on G-11 (replace grid) | earnings.ts |

**Do not merge audit PR** — docs only. Implement fixes as small `fix/nh-0dte-*` branches.

---

## 8. Appendix — env vars that move play quality

| Env | Default | Effect |
|-----|---------|--------|
| `ZERODTE_WHOLE_MARKET` | on | Master BREAKOUT+PIN switch |
| `ZERODTE_CONFLUENCE_MIN` | 2 | G-12 floor |
| `ZERODTE_SCORE_FLOOR_*` | 65 | G-3 per-origin |
| `BREAKOUT_INTRADAY_REFRESH` | **off** | Minute-bar hybrid breadth |
| `PIN_TEMPORAL_STABILITY` | **off** | Multi-snapshot wall requirement |
| `ZERODTE_MAX_CONCURRENT` | 100 | Governor cap |
| `ZERODTE_BLOCK_ACCUM_MISALIGN` | on | G-13 multi-day flow veto |
| `ZERODTE_G4/G7/G11_FAIL_CLOSED` | on | Firewall |

Full list: see subagent pipeline audit in PR description.

---

## 9. Related docs

- `docs/audit/0DTE-UNIFICATION-DESIGN.md` — design of record
- `docs/audit/0DTE-RESEARCH.md` — E2/E3 confluence evidence
- `docs/audit/NIGHTHAWK-0DTE-DECISION.md` — July 2026 gate spec
- `docs/audit/0DTE-SYSTEM.md` — system reference
- `docs/audit/FINDINGS.md` — 2026-08-14 discovery lane health, roster collapse OPEN
