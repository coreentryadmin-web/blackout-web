# VECTOR PHASE 2 — Complete RTH Validation Plan

**Generated**: 2026-08-29 17:53 UTC  
**Status**: Ready for next market open  
**Coordinator**: Full correctness audit, 100% validated scenarios  

---

## Overview

Phase 1 baseline (1065 unit tests) completed 2026-08-23. Since then, three critical correctness bugs merged:
- **#3139** (2026-08-29 13:56): Committed pivot plays skipped in pick sweep
- **#3136** (2026-08-29 13:55): Invalidation levels <$10 silently dropped
- **#3130** (2026-08-29 11:36): Committed pivot picks never invalidate on flip reversal

All three would be missed by unit tests alone. Phase 2 requires **scenario-driven, market-hours-dependent validation** that exercises real data paths.

---

## Validation Scope — 7 UNKNOWNs

### UNKNOWN #1: Transport Cap Confirmation
**Status**: ✓ LIKELY FIXED (#2649 merged, needs live RTH confirmation)
**Validation method**: `largo-truncation-probe.mjs` during RTH only
**Success criteria**: `get_vector_full_state`, `get_vector_analytics`, `get_vector_plays` all COMPLETE (no `…[truncated]` marker)
**Owner**: Run during RTH 09:30–16:00 ET

### UNKNOWN #2: Every Number, Polygon Cross-Check
**Status**: ⏳ CRITICAL — newly exposed pivot-bias bugs mean this is urgent
**Scope**:
- Walls (call/put) across 3 oracles (SPX, SPY, QQQ) + 3 shared tickers (NVDA, TSLA, SPY)
- Gamma flip (|gamma| sum, sign match)
- Expected move (σ · √(dte/365), ATM IV sourcing)
- Max pain (strike clustering, bid/ask weights)
- Gamma magnet (distance calc)
- Ladder ranks (king strikes, nearest-spot order)
- Universe rows (flipDistancePct formula)
- **NEW**: Pivot plays specifically — raw `play.bias = "neutral"`, effective bias derivation, spot commitment threshold (`PIVOT_PICK_COMMIT_EPS`)

**Validation method**: 
- Live desk (`/vector`, `/dashboard` SPX embed) + REST data dumps
- New sub-script: `validate-vector-pivot-plays.mjs` (comprehensive pivot scenario checker)

**Success criteria**: 
- All 7 field categories match Polygon primary within tolerance
- Pivot plays correctly report effective bias when spot passes commit threshold
- No silent drops or NaN returns

**Owner**: Run during RTH 10:00–14:00 ET

### UNKNOWN #3: `vector-alerts` Scheduling
**Status**: ✓ EXPECTED — feature is dormant by design, not broken
**Scope**: Clarify intent in code (P3 task only)
**Action**: Update `VectorPageShell.persistRules` inline comment to explain dormant status
**Owner**: Phase 3 (after RTH)

### UNKNOWN #4: Rail Accumulation (sequence, timing, freshness)
**Status**: ⏳ MEDIUM — depends on real-time data flow
**Scenarios**:
1. **Rail starts from one bead** — Watch `/stream` from 09:30 ET, verify first 5s bucket
2. **Rail stalls mid-session** — Monitor `/stream` + `/walls?dte=0dte` frequency, check `nowMs − cachedWallsAt ≤ 120s`
3. **Rail back-fills correctly** — Compare persisted + live samples on bucket rollover
4. **Leader lock handoff** — Document that backup cron is not deployed (gap, not bug)

**Validation method**: 
- Redis tail: `vector:wall-history:{ticker}:{ymd}` during RTH
- SSE `/stream` monitor for latency + staleness
- Script: `vector-rail-accumulation-audit.mjs` (new, monitors real-time)

**Success criteria**: 
- No skip/stall on first bucket
- Rail freshness stays ≤ 120s both sides
- Rollover narrows horizons correctly (0dte/weekly/monthly)

**Owner**: Run during RTH 10:00–15:30 ET

### UNKNOWN #5: UI Validation — Pixels and Interactions
**Status**: ⏳ HIGH PRIORITY — recent #2453 CLS fix needs regression check
**Surfaces**:
- Member `/vector` chart (Chart, Helix, Matrix, Scanner tabs)
- SPX Slayer embed (`/dashboard` SpxVectorEmbed)
- Depth ladder (rungs, spot row, honest-limits note)
- Compare 4-up mode (live, replay, drag/zoom state)
- Mobile (430×932) and desktop (1440×900)

**Validation method**: 
- `proxy-browser.cjs` for pixel-level screenshots + DOM state
- `depth-ladder-ui-audit.mjs` for ladder-specific checks
- `cls-measure.cjs` for CLS regression
- Script: `vector-ui-comprehensive-audit.mjs` (new, covers all modes)

**Success criteria**: 
- No CLS regression (< 0.1)
- No clipped text, sub-24px tap targets, or horizontal overflow
- Compare 4-up state coherence (no cross-pane leaks)
- Replay mode doesn't leak into live board state

**Owner**: Run during RTH 12:00–14:00 ET

### UNKNOWN #6: Performance (cache hit rate, staleness, SSE latency)
**Status**: ⏳ MEDIUM — baseline needed to detect regressions
**Metrics**:
- Full-state cache hit rate (>80% target during 09:30–16:00)
- Universe snapshot age (declared ~5min, measure actual drift)
- SSE frame latency (P50 <100ms, P95 <200ms)

**Validation method**: 
- Temporary instrumentation in `fetchVectorFullState`, `buildVectorStreamPayload`
- Script: `vector-perf-audit.mjs` (polls metrics every 5s for 6 hours)
- Analyze results with `vector-perf-analysis.mjs`

**Success criteria**: 
- Cache hit rate ≥ 80%
- Universe staleness ≤ 5min (measured + declared agree)
- SSE latency within targets (no outliers > 500ms)

**Owner**: Instrument during RTH 09:30 ET, collect all day, analyze after close

### UNKNOWN #7: `vector-analytics.ts` Fraction-DP (P4)
**Status**: ✓ COSMETIC ONLY — no correctness impact
**Fields**: `fib_swing.retracements[].ratio`, `golden_pocket.ratios[]` (2dp → 3dp target)
**Action**: Defer until after Phase 2 (no validation needed, cosmetic only)

---

## Deep-Dive Drill: Scenario-Driven Edge Cases

Beyond the 7 UNKNOWNs, the three recent bugs (#3139, #3136, #3130) point to critical scenario classes that need exhaustive validation:

### Pivot Play Full State Space
**Scenarios**:
1. **Uncommitted pivot** (spot exactly on `gammaFlip`):
   - Effective bias should be `null` / not used
   - Raw card bias stays "neutral"
   - Pick sweep returns `null` (no directional play)
   - Invalidation gates unreachable (correct)

2. **Committed pivot long** (spot > `gammaFlip` + `PIVOT_PICK_COMMIT_EPS`):
   - Effective bias = "long"
   - Raw card bias still "neutral"
   - Pick sweep should execute ranking
   - Invalidation gates ("close > X", "back through X") should fire

3. **Committed pivot short** (spot < `gammaFlip` - `PIVOT_PICK_COMMIT_EPS`):
   - Effective bias = "short"
   - Invalidation gates ("close < X", "back through X") should fire

4. **Pivot reversal** (spot crosses `gammaFlip` again):
   - Effective bias toggles
   - Prior committed picks invalidate
   - New direction's picks rank fresh

**Validation script**: `vector-pivot-scenario-drill.mjs` (simulates all 4, compares to live desk)

### Invalidation Level Edge Cases
**Scenarios**:
1. **Sub-$10 invalidation** ("close < 8.50") — must parse, not drop
2. **Negative levels** ("close < -0.50 in a spread scenario") — must handle
3. **Zero levels** ("close = 0") — edge case, should not crash
4. **Timeframe token skip** ("5m", "1H") — must not parse as levels
5. **Malformed** ("close bad data 999") — graceful fallback

**Validation script**: `vector-invalidation-edge-cases.mjs`

### Bias Handling Call Sites
**All places raw `play.bias` is used directly** (audit for the same class of bug):
- `vector-pick-sweep.ts` — ✓ FIXED (#3139)
- `vector-pick-sweep-core.ts` — ✓ FIXED (#3139)
- `vector-pick-live-status.ts` — ✓ FIXED (#3130)
- `use-vector-contract-picks.ts` — requires audit
- `vector-play-candidates.ts` — already correct (uses `effectivePickBias`)
- `VectorChart.tsx` — render layer, requires UI audit

**Grep pattern**: `play\.bias` (search all, audit context, report findings)

### Wall/GEX Depth Consistency
**Recent fix**: #3141 (gex-heatmap route wall-strike-totals consistency bug)
**Validation**: 
- Confirm Vector's wall rendering reads CORRECT values from the fixed route
- Cross-check `computeGexWalls` output vs `/heatmap` route payload
- Ensure no reading of stale split between per-strike and total gamma

**Validation script**: `vector-gex-depth-consistency.mjs`

---

## Execution Schedule

### RTH Window: 09:30–16:00 ET (13:30–20:00 UTC)

| Time | Validation | Script | Success gate |
|------|-----------|--------|---------------|
| 09:30–10:00 | **Wall warmup + SSE connection** | Monitor `/stream` | 3 tickers, 0 errors |
| 10:00–11:00 | **Polygon cross-check (UNKNOWN #2)** | `validate-vector-pivot-plays.mjs` | All fields match, no silent drops |
| 11:00–12:00 | **Invalidation edge cases** | `vector-invalidation-edge-cases.mjs` | All 5 scenarios pass |
| 12:00–13:00 | **UI pixel audit (desktop)** | `vector-ui-comprehensive-audit.mjs --viewport=1440x900` | CLS < 0.1, no overflow |
| 13:00–14:00 | **UI pixel audit (mobile)** | `vector-ui-comprehensive-audit.mjs --viewport=430x932` | CLS < 0.1, tap targets ≥ 24px |
| 14:00–15:00 | **Truncation probe (UNKNOWN #1)** | `largo-truncation-probe.mjs --tools=get_vector_*` | 3/3 COMPLETE |
| 15:00–15:30 | **Rail accumulation (UNKNOWN #4)** | Monitor Redis tail + collect final logs | Freshness ≤ 120s, no stalls |
| 15:30–16:00 | **Pivot scenario drill (comprehensive)** | `vector-pivot-scenario-drill.mjs` | 4/4 scenarios correct |
| After 16:00 | **Performance analysis (UNKNOWN #6)** | `vector-perf-analysis.mjs` | Hit rate ≥ 80%, latency within targets |

### Post-RTH (Phase 3)

| Task | Owner | Output |
|------|-------|--------|
| Update VECTOR-CERTIFICATION.md | Agent | New Phase 2 section with date + per-scenario status |
| For each defect found | Agent | fix/ branch, test, findings-staging entry, PR, merge |
| Audit all `play.bias` call sites | Agent | Grep + context review, report if any bugs found |
| Clarify `vector-alerts` dormant status | Agent | Inline comment update, P3 PR |

---

## Success Criteria (Phase 2 Complete)

✓ All 7 UNKNOWNs have documented status (FIXED, VALIDATED, or DEFERRED with reason)  
✓ All 4 pivot scenario classes validated live  
✓ All 5 invalidation edge cases validated  
✓ Zero RED verdicts in UI audit (CLS, overflow, tap targets, console errors)  
✓ Transport cap confirmed COMPLETE (no truncation)  
✓ Rail accumulation confirmed live + fresh  
✓ No new bugs introduced since #2649/3130/3136/3139  
✓ VECTOR-CERTIFICATION.md updated with Phase 2 dated results

---

## Appendix — Scripts to Build/Run

### New scripts required:
- `validate-vector-pivot-plays.mjs` — Polygon cross-check with pivot focus
- `vector-rail-accumulation-audit.mjs` — Real-time rail monitoring
- `vector-ui-comprehensive-audit.mjs` — All modes, viewports, CLS
- `vector-pivot-scenario-drill.mjs` — 4 scenario simulation
- `vector-invalidation-edge-cases.mjs` — 5 edge cases
- `vector-gex-depth-consistency.mjs` — Wall/depth audit
- `vector-perf-audit.mjs` — 6-hour metric collection
- `vector-perf-analysis.mjs` — Results aggregation

### Existing scripts to reuse:
- `large-truncation-probe.mjs` — Transport cap check
- `depth-ladder-ui-audit.mjs` — Depth ladder pixels
- `cls-measure.cjs` — CLS regression
- `proxy-browser.cjs` — UI screenshots + DOM

