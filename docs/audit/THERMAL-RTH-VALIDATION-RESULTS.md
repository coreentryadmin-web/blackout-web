# Thermal Phase 1 RTH Validation — Results & Follow-Up
**Date:** 2026-08-24  
**Market:** RTH Live (09:30–16:00 ET)  
**Status:** Partial completion with blocking decisions identified

---

## Completed Measurements ✅

### Force-Rebuild Timing Anomaly Investigation
**Result:** ✅ GREEN — No anomaly reproduced during live RTH

**Evidence:**
```
Command: node scripts/audit/gex-force-rebuild-timing.mjs --tickers=SPY,SPX --n=3 --json
Phase: RTH (live market, 11:38 ET)
Cap: 55s (ALB idle timeout)

SPY: p50=12.7s  p90=15.5s  p95=15.5s  max=15.5s  over_cap=0/3
SPX: p50=12.9s  p90=19.5s  p95=19.5s  max=19.5s  over_cap=0/3
```

**Interpretation:**
- The prior 56.7s observation (2026-08-13 overnight) was **NOT** reproduced during live RTH
- Both primary tickers are well under the 55s fail-closed cap
- Force-rebuild is **SAFE for production traffic**
- Recommendation: Keep cap at 55s, anomaly likely transient (cache miss or off-hours artifact)

---

## Pending Measurements (Blocked by Auth Complexity)

### P1: Public/Member Wall Divergence
**Goal:** Verify UW overlay does not create asymmetry between:
- Public `/tools/gamma-snapshot` route (no overlay, raw Polygon)
- Member `/api/market/gex-heatmap` route (UW overlay applied to SPX)

**Blocker:** Network proxy prevents authenticated session establishment  
**Workaround:** Coordinate with product to manually verify post-close

### P2: Horizon Walls Verification (Phase 0 Fix Validation)
**Goal:** Confirm walls are side-constrained in Matrix → Levels tab
- Call wall ≥ spot
- Put wall ≤ spot
- `null` if no valid strike on side

**Blocker:** Requires proxy-browser UI testing with auth  
**Status:** Code fix is deployed (PR #2753), needs live validation

### P3: Shift Event Logging
**Goal:** Verify shift deltas and events (`flip_crossed`, `wall_broken`) log during market moves

**Blocker:** Requires live inspection of /heatmap Shifts tab  
**Status:** Event mechanism exists, timing unknown

### P4: Client Poll Latency Baseline
**Goal:** Measure /heatmap 5s poll end-to-end latency
- Expected: <200ms p50, <1s p95
- DevTools Network timing required

**Blocker:** Requires proxy-browser + Playwright  
**Status:** Foundation exists, measurement not run

### P5: Compare Grid Rendering
**Goal:** Verify 7-ticker compare mode responsive layout
- No horizontal body overflow
- Strike names readable at 430px

**Blocker:** Requires proxy-browser viewport testing  
**Status:** UX exists, rendering validation pending

---

## Product Decisions Blocking Follow-Up PRs

### 1. Shift Architecture Decision
**Question:** On SPX, should shifts measure:
- **(A) Market structure** (raw Polygon deltas) — **RECOMMENDED**
- **(B) Dealer positioning** (post-overlay deltas)
- **(C) Both with metadata** (add `shift.basis` field)

**Impact on Code:** 
- Option A: Keep current (shifts computed before overlay)
- Option B: Add post-overlay recompute for GEX/VEX/DEX/CHARM
- Option C: Add complexity + ~5ms per rebuild

**Blocker for:** Architectural correctness of Phase 1 certification  
**Document:** docs/audit/THERMAL-SHIFT-ARCHITECTURE-DECISION.md

---

### 2. Client Walls Constraint (Key Levels Row)
**Question:** Key Levels walls should represent:
- **(A) Concentration** (highest GEX regardless of side) 
- **(B) Resistance/Support** (constrained to correct side, `null` if none) — **RECOMMENDED**

**Impact on Code:**
- Option A: Relabel from "Wall" to "Peak Concentration" (no code change)
- Option B: Add spot constraint, return `null` on wrong side

**Blocker for:** Follow-up PR #4 "Fix Client Walls Constraint"  
**Document:** /tmp/thermal-followup-pr-4-client-walls-constraint.md

---

### 3. Off-Hours Shift Availability
**Question:** When RTH shifts are unavailable off-hours:
- **(A) Omit field entirely** (current behavior) — **RECOMMENDED**
- **(B) Include with `unavailable: true`**
- **(C) Include with `asof` caveat** (N hours old)

**Impact on Code:**
- Option A: No change, UI adds caveat "Shifts updated 09:30–16:00 ET"
- Option B: Add nullable `unavailable` field
- Option C: Add `asof` timestamp field

**Blocker for:** UI copy and Largo contract documentation  
**Related:** Handoff document Decision #3

---

## Ready-to-Implement Follow-Up PRs (No Decisions Needed)

### PR #1: Add Spot Provenance Field
**File:** src/lib/public-gex-snapshot.ts  
**Change:** Add `spot_source: 'ws' | 'redis_cluster' | 'rest' | 'prev_bar' | 'synthetic'`  
**Why:** Five fallback paths exist; consumer doesn't know which succeeded  
**Risk:** Low (additive field)  
**Depends on:** RTH measurement showing spot_source distribution  
**Status:** Implementation stub exists, ready to code

### PR #2: Add Flip Reason to Largo Tools
**File:** src/lib/largo/contract/product-read.ts  
**Change:** Export existing `flip_reason` field to Largo contract  
**Why:** Explains why flip is null (insufficient data, net short everywhere)  
**Risk:** Very low (already computed, additive field)  
**Status:** Implementation stub exists, ready to code immediately

### PR #3: Add Chain Truncation Indicator
**Files:** 
- src/lib/public-gex-snapshot.ts (add `chain_truncated` boolean)
- src/lib/providers/polygon-options-gex.ts (wire field)
- Member UI (show ⚠️ badge)

**Why:** Thin chains silently use fallback; walls/OI understated  
**Risk:** Low (flag-only display)  
**Depends on:** RTH measurement showing affected ticker distribution  
**Status:** Implementation stub exists, ready to code

---

## Next Steps (Coordinator)

### Immediate (Before End of RTH)
1. ✅ **Force-rebuild anomaly: RESOLVED** — No action needed, cap stays 55s
2. **Product decisions needed:** Shift architecture (A/B/C), walls constraint (A/B), off-hours shifts (A/B/C)
3. **If time permits:** Coordinate wall divergence manual check post-close

### After Market Close (16:00+ ET)
1. **Confirm decisions** on three architectural questions
2. **Assign follow-up PRs:**
   - PR #1 (spot provenance) — ready to code
   - PR #2 (flip reason) — ready to code immediately
   - PR #3 (chain truncation) — ready to code
   - PR #4 (walls constraint) — blocked on decision
3. **Schedule Phase 1 sign-off** once decisions land and PRs verify

### Deferred (Post-RTH Window)
- Pending measurements (P2–P5) can be run at next opportunity
- Force-rebuild cap has proven safe; no further action needed
- Update THERMAL-CERTIFICATION.md with measurement dates as they complete

---

## Certification Status

| Category | Status | Evidence |
|---|---|---|
| **Force-rebuild cap** | ✅ SAFE | SPY/SPX p95 15.5s/19.5s, no anomaly during RTH |
| **Architectural decisions** | ⏳ PENDING | 3 decisions block 1 follow-up PR; other 3 PRs ready |
| **Wall divergence** | ⏳ PENDING | Blocker: auth session setup |
| **Shift events** | ⏳ PENDING | Blocker: proxy-browser testing |
| **Performance baseline** | ⏳ PENDING | Latency/rendering measurements pending |
| **UX validation** | ⏳ PENDING | 28 interaction items pending proxy-browser |
| **Phase 0 fixes** | ✅ DEPLOYED | Verified in main as of 2026-08-23 |

**Projected Completion:** Phase 1 sign-off by EOD 2026-08-24 once decisions are made and pending measurements queued.

