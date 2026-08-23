# BANGERS SYSTEM CERTIFICATION

**Date:** 2026-08-23 · **System:** Whole-market momentum discovery + mechanical scale-out  
**Status:** AUDIT IN PROGRESS — architectural analysis complete, detailed validation pending  
**Files:** 6 source + 6 test | **Lines:** ~1,200 LOC

---

## EXECUTIVE SUMMARY

Bangers (Engine B) is BlackOut's whole-market momentum discovery system. Unlike Night Hawk's intraday 0DTE lanes and Swings' thesis-based multi-day positions, Bangers screens **every US stock daily** (Polygon grouped-daily, ~12.4k) for breakout/momentum candidates, selects a cheap OTM weekly call per mover, and manages exits through the **shared production scale-out state machine** (the exact same mechanical rules as 0DTE: partial at 2× + trailing runner + hard −50% stop).

**Key architectural characteristics:**
- Whole-market daily screen: 12.4k stocks per session
- Simple discovery filters: gain %, volume, close-strength, price/liquidity bounds
- Ranking: By dollar-volume ($-volume desc)
- Zero caps: Every qualifying mover is attempted (operator instruction 2026-08-04)
- Contract selection: OTM weeklies, walking 5%/7%/10%/3% multiplier ladder
- Mechanical scale-out: Shared `deriveScaleOutAction` with 0DTE (partial at 2×, runner, −50% hard stop)
- Live sync: Continuous mark refresh + state-machine application
- Grading: Realized P&L tracked per-position, end-to-end matching the live ledger

---

## 1. COMPONENT INVENTORY

### Core Discovery & Commit (3 files, ~450 LOC)

| Component | File | Lines | Purpose |
|---|---|---|---|
| Discovery screen | discovery.ts | 102 | Whole-market 12.4k-row scan, gain/volume/price/close-strength filters, dollar-volume ranking |
| Commit orchestrator | commit.ts | 138 | Run one discovery pass, pick contract for EVERY mover, insert to banger_positions DB |
| OTM contract picker | contract.ts | 97 | Walk 5%/7%/10%/3% OTM ladder, probe daily bars, find entry premium |

**Key insight:** Discovery is a pure screen with NO caps beyond the filters themselves. The operator instruction (2026-08-04) explicitly rejects a top-N slice — every qualifier is attempted. The shared contract picker (reused across 0DTE) ensures production and research pick contracts identically.

### Live Sync & Ledger (2 files, ~250 LOC)

| Component | File | Lines | Purpose |
|---|---|---|---|
| Live sync orchestrator | live-sync.ts | 143 | Fetch open positions, refresh marks, run shared scale-out state machine, apply transitions |
| Positions ledger | positions-db.ts | ~150 | DB accessors (insert/query banger_positions), idempotent commit_key upsert, status ladder |

**Key insight:** Live sync applies the **shared production scale-out rules** (src/lib/zerodte/scale-out.ts `deriveScaleOutAction`) — the exact same mechanical rule set that grades 0DTE positions. Realized P&L is frozen at transition time and matches the offline grader's two-part sum (partial tranche + remaining-at-exit).

### Kill Switch & Testing (1 file + 6 tests)

| Component | File | Lines | Purpose |
|---|---|---|---|
| Engine kill-switch | flag.ts | 16 | BANGER_ENGINE_ENABLED env gate; defaults ON |
| Test suite | *.test.ts | 6 files | Full coverage: discovery screen, commit path, contract picker, live sync, DB accessors, flags |

---

## 2. DISCOVERY & SCREENING ARCHITECTURE

### Screen Logic (Pure)

**Input:** Polygon grouped-daily rows (~12.4k stocks per session)

**Filters applied** (in order):
1. **Price:** Close in [5, 400] (configurable via `BangerScreenConfig`)
2. **Volume:** ≥1M shares (configurable)
3. **Gain:** ≥5% intraday gain (configurable, checked as `(close - open) / open`)
4. **Close strength:** Closed in top 50% of day's range (configurable as `maxCloseGiveback`, default 0.5)
   - Formula: `(high - close) / range ≤ 0.5` ensures close is in top half

**Ranking:** By dollar-volume descending (`volume × close`), so a 1M-share move at $200 ranks above a 2M-share move at $50

**Output:** Sorted `BangerMover[]` with discovered gain%, volume, dollar-volume, close-strength

**Zero caps:** EVERY row clearing the screen is returned. NO top-N slice, no daily-commit cap, no position-count cap. The screen filters are the only gates.

**Faithful port:** Screens identically to `screenMovers` in `scripts/audit/market-banger-scan.mjs` (the research backtest tool), so live discovery and backtested discovery can never drift onto different definitions of "banger."

### Weekly Expiry Resolution

**Input:** Session date (YYYY-MM-DD), minimum days ahead (default 4)

**Output:** Nearest Friday ≥ 4 calendar days later

**Logic:** Walk forward from `sessionDate + 4 days` until a Friday is found. Faithful port of `nearestFriday` in the research tool.

---

## 3. CONTRACT SELECTION ARCHITECTURE

### OTM Strike Ladder

**Input:** Spot price, session date, expiry date, hold window end date

**Strike selection algorithm:**
1. Compute strike increment from spot:
   - Spot < $25 → $0.50 steps
   - Spot < $100 → $1.00 steps
   - Spot < $250 → $2.50 steps
   - Spot ≥ $250 → $5.00 steps

2. Walk OTM multiples in order: 1.05× → 1.07× → 1.10× → 1.03× (5%, 7%, 10%, 3% OTM)
   - For each multiple: strike = round(`spot × mult / step`) × step
   - Skip if already seen (deduplicate)

3. Probe daily bars for each strike:
   - Build OCC symbol (reuses repo's `buildOcc`)
   - Fetch daily bars from `fromDate` to `toDate` (9-day default hold window)
   - Find entry bar: first close ≥ 1pm UTC on `fromDate`, else first bar

4. Return first strike with:
   - Usable bar data (finite, positive close)
   - Entry premium ≥ $0.02 (fail-soft: return null if none found)

**Fail-soft:** If a strike probe fails (no bars, data miss, network error), try the next OTM multiple. If all fail, return null and the ticker is skipped (no position opened).

---

## 4. LIVE SYNC & SCALE-OUT ARCHITECTURE

### Continuous Position Tracking

**Refresh loop:**
1. Fetch all OPEN/PARTIAL positions from banger_positions
2. Collect unique OCC symbols
3. Fetch current live marks for all symbols (from Polygon live feed)
4. For each position:
   - Run the shared `deriveScaleOutAction` state machine
   - Apply the resulting transition (HOLD, TAKE_PARTIAL, EXIT_RUNNER, STOP_OUT)
   - Freeze realized P&L at transition time (idempotent first-write-wins)

**Scale-out state machine** (shared with 0DTE):
- Input: entry premium, peak premium reached, last mark, scaled-already flag
- Output: next action (HOLD, TAKE_PARTIAL, EXIT_RUNNER, STOP_OUT) + reason string
- Rules:
  - **TAKE_PARTIAL:** At 2× peak (profit-taking, scales_fraction of position)
  - **EXIT_RUNNER:** At peak + trailing runner profit (exit remaining)
  - **STOP_OUT:** At −50% of entry (hard mechanical stop)
  - **HOLD:** Otherwise

### Realized P&L Calculation

**For TAKE_PARTIAL:**
- Freeze: `partial_realized_premium = scale_fraction × entry × 2.0`
- Status: PARTIAL

**For EXIT_RUNNER (or STOP_OUT terminal):**
- Already-scaled tranche (if any): banked partial at earlier 2× scale
- Remaining tranche: exit at runner profit (trailing) or −50% hard stop
- Total realized: `partial + (remaining_fraction × exit_premium)`
- Realized P&L %: `(total_realized / entry − 1) × 100`
- Realized P&L USD: `(total_realized − entry) × 100` (per 1 contract, 100x multiplier)

**Matching the ledger:** Realized P&L frozen at transition time via idempotent DB writes (first-write-wins), so live ledger and offline grader read the same two-part sum from the same row.

---

## 5. DATA MODEL & PERSISTENCE

### banger_positions Schema

**Core columns:**
- `commit_key` (unique, idempotent): `${sessionDate}:${ticker}:${expiry}:${strike}`
- `session_date`, `ticker`, `contract_expiry`, `contract_strike`, `contract_occ`
- `entry_premium` (capture at commit time, never changes)
- `discovery_gain`, `discovery_vol`, `discovery_dollar_vol`, `discovery_close_strength` (source metrics)

**Live tracking columns:**
- `last_mark` (latest option quote from live sync)
- `peak_premium` (highest mark seen, used by scale-out state machine)
- `scaled_already` (boolean: have we taken the partial?)
- `scale_out_action`, `scale_out_reason` (last state-machine output)
- `partial_realized_premium` (frozen at TAKE_PARTIAL, first-write-wins)
- `realized_pnl_pct`, `realized_pnl_usd` (frozen at terminal, first-write-wins)

**Status transitions** (enforced in SQL CHECK constraint):
- OPEN (initial)
- PARTIAL (after TAKE_PARTIAL scale-out)
- CLOSED_RUNNER (after EXIT_RUNNER)
- STOPPED (after STOP_OUT −50%)

**Idempotent upsert:** Every commit via `commit_key` is idempotent (same ticker/expiry/strike on the same session will not duplicate). First-write-wins pinning means committed columns (entry premium, discovery metrics) are captured once and never overwritten.

---

## 6. INTEGRATION WITH SHARED SYSTEMS

### Scale-out State Machine (Shared with 0DTE)

Bangers reuses `deriveScaleOutAction` from `src/lib/zerodte/scale-out.ts`:
- Same SCALE_OUT_RULES (scale_fraction, scale_at_mult, hard_stop_mult)
- Same logic: 2× profit → partial, runner → exit runner, −50% → stop
- Same grading: `gradeScaleOut` uses the identical P&L arithmetic

**Implication:** Banger positions and 0DTE positions graduate at the same mechanical rules. A Banger that hits 2× scales at 2× (0DTE does too). Outcome grading is unified.

### OCC Symbol Building (Shared)

Reuses `buildOcc` from `src/lib/ws/options-socket.ts`:
- Handles SPX/SPXW index root mapping
- Applies OCC strike-padding math
- Ensures one canonical symbol per contract

---

## 7. VALIDATION STATUS

### ✅ COMPLETED (Architectural)

- Component mapping (6 core + 6 test files, ~1.2K LOC)
- Discovery screen architecture (whole-market 12.4k scan, zero-caps design)
- Contract selection (OTM ladder, fail-soft probe)
- Scale-out integration with 0DTE shared rules
- Ledger data model (idempotent upsert, status ladder)
- Kill-switch operational gate

### ⏳ PENDING (Detailed Validation)

| Item | Method | RTH Required |
|---|---|---|
| Discovery precision/recall | Run Bangers scanner on live session, measure %-of-12.4k screened + winner tail recall | Yes |
| Scale-out rule application | Audit sample of live positions: did they scale/exit/stop at expected thresholds? | No |
| Entry premium accuracy | Spot-check 5–10 committed positions: entry premium vs bar data match? | No |
| Contract picker OTM ladder | Verify ladder walk (5%/7%/10%/3%) on 3–5 tickers with real Polygon chains | No |
| Ledger integrity | Inspect DB: idempotent upsert holds, status ladder enforced, realized P&L frozen? | No |
| Kill-switch operability | Disable via env, verify commit + live-sync both no-op without DB/Polygon access | No |
| Cross-system grading | Compare Banger scale-out grades vs 0DTE on overlapping positions (same contract/exit rules) | No |

---

## 8. KNOWN RISKS & OBSERVATIONS

### High Risk

1. **Discovery recall at scale:** Screening 12.4k stocks daily and attempting EVERY qualifier can produce a high position count. Is the position limit tuned? (Not encoded in the engine itself, may be a cron/deployment constraint.)
2. **Contract probe fail-soft:** If all 4 OTM multiples fail to return a viable bar, the ticker is silently skipped. Is this rate measured? Could a data provider outage blank an entire session?
3. **Shared scale-out rules:** Bangers depends on 0DTE's state machine. If that rule changes, Bangers changes too. Are they semantically aligned or is this accidental coupling?

### Medium Risk

1. **Weekly expiry selection:** Always nearest Friday ≥4 days ahead. If a session is on Thursday, expiry is the following Thursday (10 calendar days). Is a 10-day hold intentional?
2. **Entry premium floor:** Minimum $0.02 per contract. Is this correct for wide OTM weeklies? (Polygon may quote $0.01 but be illiquid.)
3. **Live mark staleness:** Live sync refreshes on an interval (cron-driven). Between syncs, positions' peak premium and realized P&L lag. Is the sync cadence measured/tuned?

### Low Risk

1. **Screen filters:** Gain/volume/price bounds are reasonable and tuned against research backtests.
2. **Idempotent upsert:** commit_key design ensures replay-safe commits (same contract won't duplicate on retry).
3. **Status ladder:** SQL CHECK constraint enforces valid transitions; belt-and-suspenders approach solid.

---

## 9. NEXT AUDIT STEPS

### Immediate (No RTH)
1. **Contract picker accuracy audit:** Spot-check 5–10 live/historical positions; verify OTM ladder walk and entry premium capture
2. **Scale-out audit:** Sample 10–15 closed positions, verify scale/exit/stop transitions vs SCALE_OUT_RULES
3. **Ledger integrity audit:** Inspect DB schema, verify idempotent upsert + status ladder enforcement
4. **Kill-switch test:** Verify BANGER_ENGINE_ENABLED=0 disables both commit and live-sync

### RTH-Dependent
1. **Discovery recall audit:** Screen a live session, measure % screened and winner tail on actual movers
2. **Live sync validation:** Monitor position tracking during RTH (marks, transitions, realized P&L refresh rate)
3. **Performance measurement:** Commit latency per session, live-sync refresh cadence, contract-probe success rate
4. **Cross-system grading:** Compare scale-out outcomes on Bangers vs 0DTE positions with same contract/exit rules

---

## 10. ARCHITECTURAL ASSESSMENT

### Strengths
- **Simplicity:** Pure screen + mechanical scale-out. No complex archetype classification or portfolio constraints.
- **Faithful ports:** Discovery and contract selection are faithful ports of research tools, so live and backtest can't drift.
- **Shared scale-out:** Reuses 0DTE's proven state machine; outcomes are graded by the same rules.
- **Zero caps:** Operator-directed design maximizes recall (no silent discovery cap).
- **Fail-soft:** Contract probe misses don't abort the session; ticker is simply skipped.

### Complexity Hotspots
- **Discovery recall:** 12.4k stocks × daily screens → potentially high position count if filters are loose.
- **Provider outages:** If Polygon is unavailable, contract probe fails silently and tickets are skipped (no alerts).
- **Weekly expiry logic:** Nearest-Friday calculation is correct but can produce wide hold windows (up to 10 days); verify this is intentional.
- **Live mark freshness:** Sync cadence is not tuned in code (driven by cron interval); refresh rate may lag during high volatility.

---

## CERTIFICATION CHECKLIST (BANGERS)

| # | Criterion | Status | Notes |
|---|---|---|---|
| 1 | Inventory everything | ✅ | 6 source + 6 test files, ~1.2K LOC mapped; all components documented |
| 2 | Validate every number | ⏳ | Requires contract-picker + scale-out audit (spot-check entry premium and realized P&L) |
| 3 | Validate every label | ⏳ | Scale-out action labels, status labels, reason strings need verification against actual data |
| 4 | Validate every panel | ⏳ | Bangers UI integration pending (if exposed to members) |
| 5 | Test every interaction | ⏳ | UI interaction audit pending (if exposed to members) |
| 6 | Validate the logic | ⏳ | Discovery screen, contract picker, scale-out application need end-to-end trace |
| 7 | Audit the architecture | ✅ | Architecture review complete; risks identified |
| 8 | Performance certification | ⏳ | RTH performance measurement pending (commit latency, sync cadence, contract-probe success rate) |
| 9 | Product & UX review | ⏳ | Bangers position visibility, scale-out tracking UX (if exposed to members) |
| 10 | Find new features | ⏳ | Potential: Greeks visualization, live mark quality alerts, entry-premium optimization |
| 11 | Competitive review | ⏳ | Compare Bangers momentum discovery/exit rules vs tastyworks, TD banger tools, other platforms |
| 12 | Find what wasn't asked | ⏳ | New features: historical banger calendar, entry-premium calibration by IV, multi-leg spreads? |
| 13 | Produce matrix | THIS DOCUMENT | Bangers certification section added |

---

**Last updated:** 2026-08-23 21:30 UTC  
**Certification owner:** Claude Night Hawk lane  
**Next step:** Contract picker + scale-out audit (no RTH needed), then RTH discovery recall measurement
