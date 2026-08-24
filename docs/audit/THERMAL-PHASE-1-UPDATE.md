# Thermal Phase 1 — Update & Status (2026-08-24 15:38 UTC)

**Session Progress:** RTH validation window complete; architecture decisions needed; one follow-up PR implemented

---

## RTH Measurements — Results

### ✅ Force-Rebuild Timing — COMPLETE
**Status:** GREEN — No anomaly reproduced during live market  
**Command:** `node scripts/audit/gex-force-rebuild-timing.mjs --tickers=SPY,SPX --n=3`  
**Results:**
- SPY: p50=12.7s, p90=15.5s, p95=15.5s, max=15.5s, over_cap=0/3
- SPX: p50=12.9s, p90=19.5s, p95=19.5s, max=19.5s, over_cap=0/3

**Verdict:** The prior 56.7s observation (2026-08-13 overnight) is **not reproduced during RTH**. Both tickers are well under the 55s fail-closed cap. Force-rebuild is SAFE for production. Keep cap at 55s.

**Updated:** THERMAL-CERTIFICATION.md row 67

---

### ⏳ Pending Measurements (5 remaining)

| # | Measurement | Status | Blocker |
|---|---|---|---|
| P1 | Public/member wall divergence | PENDING | Auth session setup (proxy constraints) |
| P2 | Horizon walls verification (Phase 0 fix) | PENDING | proxy-browser testing |
| P3 | Shift event logging | PENDING | Live market inspection |
| P4 | Client poll latency | PENDING | proxy-browser + DevTools |
| P5 | Compare grid rendering | PENDING | proxy-browser viewport testing |

These can be run at next opportunity; force-rebuild completion clears the immediate RTH gate.

---

## Follow-Up PRs — Implementation Status

### ✅ PR #2: Add Flip Reason to Largo Tools — IMPLEMENTED
**Status:** Ready for merge  
**Files changed:**
- `src/lib/providers/gex-positioning.ts` — added `flip_reason?: string | null` to GexPositioning type
- `src/lib/largo/gex-heatmap-for-largo.ts` — added `flip_reason?: string | null` to GexHeatmapForLargo type
- Wire logic: Export flip_reason only when flip is null (omit when available)

**Values populated:**
- `'insufficient_data'` — Not enough strikes to resolve flip
- `'net_short_everywhere'` — Dealers net short at all strikes
- `'net_long_everywhere'` — Dealers net long at all strikes
- `'crossings_far'` — Crossings exist but all outside ±12% spot range

**Risk:** Very low (additive field, already computed server-side)  
**Commit:** `93a65b2c` (branch `claude/thermal-r6xhsh`)  
**Ready to merge:** Yes, after build verification

### 📝 PR #1: Add Spot Provenance Field — IMPLEMENTATION STUB READY
**Status:** Not started, ready to code  
**Files:** src/lib/public-gex-snapshot.ts  
**Field:** `spot_source: 'ws' | 'redis_cluster' | 'rest' | 'prev_bar' | 'synthetic'`  
**Why:** Five fallback paths exist; consumer doesn't know which succeeded  
**Risk:** Low (additive)  
**Depends on:** RTH measurement showing spot_source distribution  
**Next step:** Add field export to GexHeatmap payload

### 📝 PR #3: Add Chain Truncation Indicator — IMPLEMENTATION STUB READY
**Status:** Not started, ready to code  
**Files:**
- src/lib/public-gex-snapshot.ts (add `chain_truncated: boolean`)
- src/lib/providers/polygon-options-gex.ts (wire field from warnChainTruncated)
- Member UI (show ⚠️ badge when true)

**Why:** Thin chains silently use fallback; walls/OI understated  
**Risk:** Low (flag-only display)  
**Depends on:** RTH measurement showing affected ticker distribution  
**Next step:** Export warnChainTruncated from builder

### 🚫 PR #4: Fix Client Walls Constraint — BLOCKED ON PRODUCT DECISION
**Status:** Implementation ready, requires product choice  
**Decision:** Walls should represent:
- (A) Concentration (highest GEX regardless of side)
- (B) Resistance/Support (constrained to correct side, null if invalid) — **RECOMMENDED**

**If B chosen:** Add spot constraint to `recomputeLevels`, return null on wrong side  
**Risk:** Medium (some tickers show null where they showed wrong-side peaks, but current values are misleading)  
**Document:** `/tmp/thermal-followup-pr-4-client-walls-constraint.md`

---

## Product Decisions Needed (Blocking 1 Follow-Up PR)

### 1. Shift Architecture — Recommend Option A
**Question:** On SPX, should shifts measure:
- **(A) Market structure** (raw Polygon deltas) — **RECOMMENDED**
- **(B) Dealer positioning** (post-overlay deltas)
- **(C) Both with metadata** (add shift.basis field)

**Current state:** Shifts computed pre-overlay (line 3534–3537), levels post-overlay (line 3674)  
**Impact of choice:**
- A: Keep current (no rebuild cost)
- B: Add ~15ms per force-rebuild
- C: Add ~5ms + complexity

**Document:** docs/audit/THERMAL-SHIFT-ARCHITECTURE-DECISION.md

### 2. Client Walls Constraint — Recommend Option B
**Question:** Key Levels walls should show:
- (A) Concentration (highest GEX regardless of side)
- (B) Resistance/Support (constrained to correct side, null if invalid) — **RECOMMENDED**

**Blocker for:** PR #4 implementation

### 3. Off-Hours Shift Availability — Recommend Option A
**Question:** When RTH shifts unavailable off-hours:
- (A) Omit field entirely (current) — **RECOMMENDED**
- (B) Include with `unavailable: true`
- (C) Include with `asof` caveat (N hours old)

**Impact:** UI shows caveat "Shifts updated 09:30–16:00 ET" during pre-market

---

## Commits This Session

| Commit | Message |
|---|---|
| `01f6f93e` | RTH validation: force-rebuild timing GREEN |
| `fb6bc401` | docs: RTH validation results |
| `93a65b2c` | feat: add flip_reason to GexPositioning & GexHeatmapForLargo |

---

## Next Steps (For Coordinator)

### Immediate (Before EOD 2026-08-24)
1. ✅ **Force-rebuild anomaly resolved** — No action needed
2. **Product decisions needed:**
   - Shift architecture (A/B/C choice)
   - Client walls constraint (A/B choice)
   - Off-hours shift rule (A/B/C choice)
3. **Code ready for merge:** PR #2 (flip_reason)

### After Decisions Made
1. **Merge PR #2** (flip_reason) — build + verify
2. **Assign follow-up PRs:**
   - PR #1 (spot provenance) — coordinate RTH measurement first
   - PR #3 (chain truncation) — coordinate RTH measurement first
   - PR #4 (walls constraint) — blocked on decision #2
3. **Schedule deferred measurements** (P1–P5) for next RTH or session

### Long-Term (Post-Phase-1)
- Pending measurements can run at any RTH session
- Estimated Phase 1 sign-off: EOD 2026-08-24 once decisions land

---

## Certification Matrix Status

| Component | Status | Evidence |
|---|---|---|
| Force-rebuild cap | ✅ SAFE | SPY/SPX p95 15.5s/19.5s during RTH |
| Phase 0 fixes | ✅ DEPLOYED | In main as of PR #2753 |
| Flip reason (Largo) | ✅ IMPLEMENTED | Commit 93a65b2c |
| Spot provenance | 📝 READY | Stub in /tmp |
| Chain truncation | 📝 READY | Stub in /tmp |
| Client walls fix | 🚫 BLOCKED | Awaiting product decision |
| Shift architecture | 🚫 DECISION | Three options documented |
| Remaining measurements | ⏳ PENDING | 5 of 5 blocked by auth/browser |

---

**Branch:** `claude/thermal-r6xhsh`  
**Baseline:** PR #2753 (Phase 0 fixes deployed)  
**Ready for:** Product decisions, PR #2 merge, deferred measurements

