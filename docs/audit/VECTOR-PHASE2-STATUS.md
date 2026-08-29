# VECTOR PHASE 2 — Validation Status Tracker

**Updated**: 2026-08-29 17:53 UTC  
**Target**: Complete by Monday 2026-09-02 RTH close (20:00 UTC)  

---

## Overview

Phase 2 validation plan created (VECTOR-PHASE2-VALIDATION-PLAN.md). Three critical correctness bugs fixed today (#3139, #3136, #3130). Phase 2 will formally validate:
- All 7 Phase 1 UNKNOWNs
- New edge cases for pivot plays, invalidation, and bias handling
- Transport cap confirmation (UNKNOWN #1)
- Polygon cross-checks (UNKNOWN #2) — **HIGH PRIORITY**
- Rail accumulation (UNKNOWN #4)
- UI regression (UNKNOWN #5)
- Performance baseline (UNKNOWN #6)

---

## UNKNOWN #1: Transport Cap Confirmation

| Metric | Target | Status | Notes |
|--------|--------|--------|-------|
| `get_vector_full_state` | COMPLETE | ⏳ PENDING RTH | Run `largo-truncation-probe.mjs` next open |
| `get_vector_analytics` | COMPLETE | ⏳ PENDING RTH | Regimize at 96% (no truncation) |
| `get_vector_plays` | COMPLETE | ⏳ PENDING RTH | First validation since #2649 merged |

**Script**: `largo-truncation-probe.mjs --tools=get_vector_*`  
**When**: RTH 14:00–15:00 ET (18:00–19:00 UTC)  
**Owner**: Queue for next open

---

## UNKNOWN #2: Polygon Cross-Check (CRITICAL)

### Wall validation (3 oracles × 3+ tickers)

| Ticker | Oracle | Call wall | Put wall | Status | Evidence |
|--------|--------|-----------|----------|--------|----------|
| SPX | oracle | — | — | ⏳ RTH pending | New script `validate-vector-pivot-plays.mjs` |
| SPY | oracle | — | — | ⏳ RTH pending | Reuse existing checks |
| QQQ | oracle | — | — | ⏳ RTH pending | Multi-oracle cross-check |
| NVDA | shared | — | — | ⏳ RTH pending | Low-priced shared ticker |
| TSLA | shared | — | — | ⏳ RTH pending | Volatile shared ticker |
| IWM | shared | — | — | ⏳ RTH pending | Index-tracking shared ticker |

### Other fields

| Field | Validation | Status | Priority |
|-------|-----------|--------|----------|
| Gamma flip (|gamma| sum, sign) | Cross-check vs Polygon | ⏳ RTH | HIGH |
| Expected move (σ · √(dte/365)) | ATM IV sourcing | ⏳ RTH | HIGH |
| Max pain (bid/ask weights) | Strike clustering logic | ⏳ RTH | MEDIUM |
| Gamma magnet (distance calc) | `((spot−pin)/spot)·100` formula | ⏳ RTH | MEDIUM |
| Ladder ranks (king strikes) | King-retention + nearest-spot | ⏳ RTH | MEDIUM |
| Universe rows (flipDistancePct) | `((flip−spot)/spot)·100` | ⏳ RTH | MEDIUM |

**Script**: `validate-vector-pivot-plays.mjs --tickers=SPX,SPY,NVDA,TSLA,QQQ,IWM --json`  
**When**: RTH 10:00–11:00 ET (14:00–15:00 UTC)  
**Owner**: Next open (high priority)

---

## UNKNOWN #3: `vector-alerts` Scheduling (P3 — Defer)

| Item | Status | Action |
|------|--------|--------|
| Feature dormancy | Expected, not broken | Add inline comment in VectorPageShell.persistRules |
| Cron undeployed | Intentional gap | Document in code |
| UI tooltip | "while in background" | Accurate, no change needed |

**Action**: P3 PR after Phase 2 (low priority)

---

## UNKNOWN #4: Rail Accumulation (MEDIUM)

| Scenario | Validation | Status | Target |
|----------|-----------|--------|--------|
| **Rail starts correctly** | First 5s bucket, no skip | ⏳ RTH 09:30 | 0 skips |
| **Rail freshness** | `nowMs − cachedAt ≤ 120s` | ⏳ RTH monitor | ≤ 120s both sides |
| **Bucket rollover** | Narrow horizons correctly | ⏳ RTH 09:45+ | 0DTE/weekly/monthly coherent |
| **Leader lock handoff** | Backup cron not deployed | ✓ KNOWN GAP | Document gap, not test failure |

**Script**: `vector-rail-accumulation-audit.mjs` (new, monitors Redis tail)  
**When**: RTH 10:00–15:30 ET (14:00–19:30 UTC)  
**Owner**: Build script for next open

---

## UNKNOWN #5: UI Validation (HIGH)

### Regression checks

| Check | Target | Status | Tool |
|-------|--------|--------|------|
| **CLS** | < 0.1 (no regression) | ⏳ RTH | `cls-measure.cjs` |
| **Tap targets** | ≥ 24px | ⏳ RTH | `vector-ui-comprehensive-audit.mjs` |
| **Clipped text** | None | ⏳ RTH | `proxy-browser.cjs` + visual audit |
| **Horizontal overflow** | None | ⏳ RTH | `vector-ui-comprehensive-audit.mjs` |
| **Compare 4-up state** | No cross-pane leaks | ⏳ RTH | New scenario audit |
| **Replay mode isolation** | No leak to live board | ⏳ RTH | New scenario audit |

### Viewport coverage

| Viewport | Surface | Status | When |
|----------|---------|--------|------|
| 1440×900 | `/vector` (Chart, Helix, Matrix, Scanner) | ⏳ RTH | 12:00–13:00 ET |
| 1440×900 | `/dashboard` (SPX Slayer embed) | ⏳ RTH | 12:00–13:00 ET |
| 1440×900 | Depth ladder | ✓ COVERED | `depth-ladder-ui-audit.mjs` existing |
| 430×932 | `/vector` mobile | ⏳ RTH | 13:00–14:00 ET |
| 430×932 | Mobile Depth ladder | ⏳ RTH | 13:00–14:00 ET |

**Scripts**: `vector-ui-comprehensive-audit.mjs` (new), `depth-ladder-ui-audit.mjs` (existing), `cls-measure.cjs` (existing)  
**When**: RTH 12:00–14:00 ET (16:00–18:00 UTC)  
**Owner**: Build comprehensive script for next open

---

## UNKNOWN #6: Performance (MEDIUM)

| Metric | Baseline | Target | Status | Tool |
|--------|----------|--------|--------|------|
| **Cache hit rate** | Unknown | ≥ 80% | ⏳ RTH | `vector-perf-audit.mjs` (new) |
| **Universe staleness** | Declared ~5min | Measured ≤ 5min | ⏳ RTH | `vector-perf-audit.mjs` |
| **SSE latency P50** | Unknown | < 100ms | ⏳ RTH | `vector-perf-audit.mjs` |
| **SSE latency P95** | Unknown | < 200ms | ⏳ RTH | `vector-perf-audit.mjs` |

**Instrumentation**: Temporary logging in `fetchVectorFullState`, `buildVectorStreamPayload` (RTH only)  
**Script**: `vector-perf-audit.mjs` (collect), `vector-perf-analysis.mjs` (analyze)  
**When**: RTH 09:30–16:00 ET (13:30–20:00 UTC) — collect all day  
**Owner**: Build collection scripts for next open

---

## UNKNOWN #7: `vector-analytics.ts` Fraction-DP (P4 — Cosmetic)

| Field | Current | Target | Status |
|-------|---------|--------|--------|
| `fib_swing.retracements[].ratio` | 2dp | 3dp | ⏳ DEFERRED P4 |
| `golden_pocket.ratios[]` | 2dp | 3dp | ⏳ DEFERRED P4 |

**Action**: Deferred to post-Phase 2 (no correctness impact, cosmetic only)

---

## Deep-Dive Edge Cases

### Pivot Play Scenarios (4 classes)

| Scenario | Validation | Status | Script |
|----------|-----------|--------|--------|
| **Uncommitted pivot** | Effective bias = null, raw = neutral | ⏳ RTH | `vector-pivot-scenario-drill.mjs` |
| **Committed long** | Effective = "long", invalidation gates fire | ⏳ RTH | `vector-pivot-scenario-drill.mjs` |
| **Committed short** | Effective = "short", invalidation gates fire | ⏳ RTH | `vector-pivot-scenario-drill.mjs` |
| **Reversal** | Effective toggles, picks invalidate | ⏳ RTH | `vector-pivot-scenario-drill.mjs` |

**Script**: `vector-pivot-scenario-drill.mjs` (new)  
**When**: RTH after 11:30 ET (15:30 UTC) — requires spot movement  
**Owner**: Build scenario simulator for next open

### Invalidation Edge Cases (5 classes)

| Case | Test | Status | Script |
|------|------|--------|--------|
| **Sub-$10** | "close < 8.50" → parse 8.5 | ⏳ RTH | `vector-invalidation-edge-cases.mjs` |
| **Negative** | "close < -0.50" → handle gracefully | ⏳ RTH | `vector-invalidation-edge-cases.mjs` |
| **Zero** | "close = 0" → no crash | ⏳ RTH | `vector-invalidation-edge-cases.mjs` |
| **Timeframe skip** | "5m", "1H" → not parsed as levels | ✓ TESTED | Existing unit tests |
| **Malformed** | "bad data" → graceful fallback | ⏳ RTH | `vector-invalidation-edge-cases.mjs` |

**Script**: `vector-invalidation-edge-cases.mjs` (new)  
**When**: RTH 11:00–12:00 ET (15:00–16:00 UTC)  
**Owner**: Build edge case validator for next open

### `play.bias` Call Site Audit (Grep)

| File | Calls | Status | Finding |
|------|-------|--------|---------|
| `vector-pick-sweep.ts` | 2 | ✓ FIXED #3139 | `effectivePickBias()` now used |
| `vector-pick-sweep-core.ts` | 1 | ✓ FIXED #3139 | `effectivePickBias()` now used |
| `vector-pick-live-status.ts` | 1 | ✓ FIXED #3130 | `effectivePickBias()` called in route |
| `use-vector-contract-picks.ts` | ? | ⏳ AUDIT | Requires review |
| `vector-play-candidates.ts` | ? | ✓ EXPECTED CORRECT | Already uses `effectivePickBias()` |
| `VectorChart.tsx` | ? | ⏳ AUDIT | Render layer review |

**Method**: `grep -r "play\.bias" src/features/vector/lib/ --include="*.ts" --include="*.tsx"` + context review  
**When**: RTH or after Phase 2  
**Owner**: Full audit for next open

### Wall/GEX Depth Consistency (New fix awareness)

| Check | Status | Notes |
|-------|--------|-------|
| Route fix #3141 | ✓ AWARE | gex-heatmap wall-strike-totals consistency |
| Vector read path | ⏳ AUDIT | Confirm Vector reads CORRECT values post-fix |
| `computeGexWalls` | ⏳ AUDIT | Cross-check output vs `/heatmap` |
| Per-strike vs total | ⏳ AUDIT | No stale split reading |

**Script**: `vector-gex-depth-consistency.mjs` (new)  
**When**: RTH after fix verification (post-#3141)  
**Owner**: Build consistency audit for next open

---

## RTH Execution Checklist (Monday 2026-09-02)

### Pre-RTH (09:00–09:30 ET / 13:00–13:30 UTC)
- [ ] Mint temp admin Clerk user
- [ ] Verify SSE `/stream` connection stable
- [ ] Confirm 3+ tickers are market-active
- [ ] Start performance metric collection

### RTH 09:30–10:00 ET (13:30–14:00 UTC)
- [ ] Wall warmup — verify 3 oracles + 3 shared live
- [ ] Check no errors in live desk logs

### RTH 10:00–11:00 ET (14:00–15:00 UTC)
- [ ] **Polygon cross-check #2** — run `validate-vector-pivot-plays.mjs`
- [ ] Verify walls match within tolerance
- [ ] Document any out-of-range findings

### RTH 11:00–12:00 ET (15:00–16:00 UTC)
- [ ] **Invalidation edge cases** — run `vector-invalidation-edge-cases.mjs`
- [ ] Test sub-$10, negative, zero, timeframe, malformed

### RTH 12:00–13:00 ET (16:00–17:00 UTC)
- [ ] **UI desktop audit** — run `vector-ui-comprehensive-audit.mjs --viewport=1440x900`
- [ ] Check CLS, tap targets, clipping, overflow
- [ ] Validate Chart, Helix, Matrix, Scanner

### RTH 13:00–14:00 ET (17:00–18:00 UTC)
- [ ] **UI mobile audit** — run `vector-ui-comprehensive-audit.mjs --viewport=430x932`
- [ ] Validate all surfaces on mobile

### RTH 14:00–15:00 ET (18:00–19:00 UTC)
- [ ] **Truncation probe #1** — run `largo-truncation-probe.mjs --tools=get_vector_*`
- [ ] Confirm COMPLETE on all three tools

### RTH 15:00–15:30 ET (19:00–19:30 UTC)
- [ ] **Rail accumulation #4** — collect final Redis tail + SSE logs
- [ ] Verify freshness ≤ 120s, no stalls

### RTH 15:30–16:00 ET (19:30–20:00 UTC)
- [ ] **Pivot scenario drill** — run `vector-pivot-scenario-drill.mjs`
- [ ] Validate 4 scenario classes

### Post-RTH (After 16:00 ET / 20:00 UTC)
- [ ] Analyze performance metrics from collection run
- [ ] Review all findings
- [ ] For each P1/P2 defect found: create fix/ branch + PR
- [ ] Update VECTOR-CERTIFICATION.md Phase 2 results

---

## Summary — Pending Actions

**Scripts to build** (9 total):
1. ✓ `validate-vector-pivot-plays.mjs` — DONE
2. ⏳ `vector-rail-accumulation-audit.mjs`
3. ⏳ `vector-ui-comprehensive-audit.mjs`
4. ⏳ `vector-pivot-scenario-drill.mjs`
5. ⏳ `vector-invalidation-edge-cases.mjs`
6. ⏳ `vector-gex-depth-consistency.mjs`
7. ⏳ `vector-perf-audit.mjs`
8. ⏳ `vector-perf-analysis.mjs`
9. Reuse: `largo-truncation-probe.mjs`, `depth-ladder-ui-audit.mjs`, `cls-measure.cjs`, `proxy-browser.cjs`

**When**: Remaining scripts due before next market open (Monday 2026-09-02 09:30 ET)

**Next checkpoint**: Monday RTH 09:30 ET — begin Phase 2 validation run

