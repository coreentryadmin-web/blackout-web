# Thermal Product Certification — Phase 1 Handoff

**Status:** 31/80 items verified, 46 pending (35 RTH-dependent). Phase 0 fixes deployed and confirmed.

**Deliverables completed this session:**
1. ✅ Full inventory (THERMAL-MAP.md)
2. ✅ 80-item validation matrix (THERMAL-CERTIFICATION.md)
3. ✅ Architecture audit (data pipeline, caching, observability)
4. ✅ Performance baseline (overnight measurements)
5. ✅ Competitive review (SpotGamma, GammaEdge, CBOE, LiveVol, Barchart)
6. ✅ Five Phase 0 fixes deployed to main:
   - Route registry descriptions corrected (BIE knowledge base alignment)
   - Route class corrected (gex-heatmap/explain: read→mutation)
   - Empty heatmap field consistency (near_term_expiries)
   - Regime/flip/walls fixes (DTE bucketing, constraint logic)
   - Overlap/overlay documentation

**Blocking Decisions Needed Before Follow-up PRs:**

### 1. Shift Architecture (GEX/VEX/DEX/CHARM Post-Overlay)
**Decision document:** THERMAL-SHIFT-ARCHITECTURE-DECISION.md

**What to decide:** On SPX, should shifts represent:
- **(A) Market structure change** (raw Polygon deltas) — zero cost, requires member education
- **(B) Dealer positioning change** (post-overlay deltas) — ~15ms rebuild cost, correlates with visible levels
- **(C) Both with metadata** — add shift.basis field (~5ms + complexity)

**Recommended:** Option A + documentation caveat (lowest risk). Shift tells "what changed in the market"; levels tell "what the dealer is positioned at" — these are intentionally different signals.

**Depends on:** Product/trader feedback on whether they actively use shift as a trading signal.

### 2. Client Walls Constraint (Key Levels Row)
**Decision document:** /tmp/thermal-followup-pr-4-client-walls-constraint.md

**What to decide:** Key Levels walls should be:
- **(A) Concentration** — highest GEX on each side regardless of spot (always a value, but may be wrong-side)
- **(B) Resistance/Support** — constrained to correct side of spot (null if no valid level)

**Recommended:** Option B (constrain). Walls are directional signals; showing wrong-side peaks is misleading.

**Depends on:** Product design intent for Key Levels row.

### 3. Off-Hours Shift Availability
**What to decide:** Shifts forced unavailable off-RTH by `applyHeatmapMemberPresentationGates`. Should we:
- **(A) Omit field** (current behavior — no "shifts" object in off-RTH payload)
- **(B) Include with `unavailable: true`** + reason field
- **(C) Include with `asof` caveat** — shifts are N hours old

**Recommended:** Option A + UI caveat ("Shifts updated during RTH 09:30–16:00 ET").

**Depends on:** Member feedback on off-hours shift consumption.

---

## RTH Validation Window — 2026-08-24 09:30–16:00 ET

**Measurement plan:** /tmp/thermal-rth-measurement-plan.md

**Critical measurements (product decision gates):**
1. **Force-rebuild timing anomaly** — SPY 56.7s spike investigation (cap validation)
2. **Public/member wall divergence** — UW overlay on public route decision
3. **Horizon walls verification** — Phase 0 fix validation (regression check)
4. **Shift event logging** — Event mechanism verification
5. **Client poll latency** — Cache performance baseline
6. **Compare grid rendering** — Responsive layout validation

**Session checklist:**
- 09:30 ET: Auth into /heatmap
- 10:00–15:00 ET: Automated measurements + manual inspection
- 15:00+ ET: Summarize results → update certification matrix

**Expected outcomes:** All six measurements should confirm green flags (walls correct, no divergence >0.5%, force-rebuild <55s, events logged). Any red flag triggers follow-up investigation.

---

## Ready-to-Go Follow-Up PRs (No Decisions Needed)

### 1. Add Spot Provenance Field
**File:** /tmp/thermal-followup-pr-1-spot-provenance.md

**What:** Add `spot_source: 'ws' | 'redis_cluster' | 'rest' | 'prev_bar' | 'synthetic'` to heatmap payload

**Why:** Five fallback paths exist; consumer doesn't know which succeeded. Needed for debugging (WS live vs cached) and transparency (data freshness).

**Risk:** Low (additive field). **Blocker:** None.

**Ready to implement:** Yes, once RTH measurement shows spot_source distribution.

### 2. Add Flip Reason to Largo Tools
**File:** /tmp/thermal-followup-pr-2-flip-reason-largo.md

**What:** Export existing `flip_reason` to Largo contract for `get_gex_heatmap` / `get_positioning` tools

**Why:** `flip` can be null (insufficient data); Largo needs `flip_reason` to explain why to downstream models.

**Risk:** Low (additive field, already computed). **Blocker:** None.

**Ready to implement:** Yes, immediately.

### 3. Add Chain Truncation Indicator
**File:** /tmp/thermal-followup-pr-3-chain-truncation.md

**What:** Add `chain_truncated: boolean` field; show ⚠️ badge in UI when true

**Why:** Thin/low-priced names use fallback chains; walls/OI understated. Members don't know.

**Risk:** Low (flag-only display). **Blocker:** None.

**Ready to implement:** Yes, once RTH measurement confirms distribution.

### 4. Client Walls Constraint Fix
**File:** /tmp/thermal-followup-pr-4-client-walls-constraint.md

**What:** Constrain Key Levels walls to correct side of spot, return null if invalid

**Why:** Currently shows wrong-side walls (call wall below spot), misleading traders.

**Risk:** Medium (some tickers show null where they showed values, but current values are wrong). **Blocker:** Product decision on Option A vs B.

**Ready to implement:** After product decision (recommend Option B).

---

## Summary Status

| Category | Status | Blocker? | Next Step |
|---|---|---|---|
| **Completed** | Inventory, architecture, performance, competitive | No | → RTH measurement |
| **Phase 0 fixes** | All 5 deployed + verified | No | → Monitor production |
| **Shift architecture** | Decision document ready | Yes | → Product decision |
| **Client walls** | Decision document ready | Yes | → Product decision |
| **Off-hours shifts** | Rule documented | No | → Update UI caveat |
| **Spot provenance** | Implementation stub ready | No | → Code + RTH verify |
| **Flip reason** | Implementation stub ready | No | → Code immediately |
| **Chain truncation** | Implementation stub ready | No | → Code + RTH verify |
| **UX interaction testing** | Proxy-browser plan ready | No | → RTH execution |
| **Performance validation** | RTH measurement plan ready | No | → RTH execution (08-24) |

---

## Friday Evening Preparation (2026-08-23 19:52)

**Do tonight:**
1. ✅ Commit RTH measurement plan and PR stubs to `/tmp` (this file)
2. ✅ Verify all decision documents are in docs/audit/
3. ✅ Brief coordinator on blocking decisions + RTH schedule

**Tomorrow morning (2026-08-24 09:30 ET):**
1. Execute RTH measurement window (checklist above)
2. Capture screenshots (proxy-browser sprint)
3. Verify Phase 0 fixes haven't regressed

**After RTH (end of day):**
1. Update certification matrix with live results
2. Summarize measurement outcomes (blockers vs green flags)
3. If all green: start follow-up PR work (assign no-decision PRs)
4. If blockers found: escalate + trace root cause

**Projected completion:** Phase 1 certification sign-off by 2026-08-24 16:30 ET (30 min after market close), with all follow-up PRs assigned and estimated shipping dates.

---

## Open Questions for Product/Leadership

1. **Shift signal intent:** Are traders actively using shift as a trading signal, or is it supplemental context? (Informs Option A vs B decision)
2. **Public route data policy:** Is it intentional that public route doesn't get UW dealer overlay, or should we add it? (Informs Option A vs B wall divergence)
3. **Mobile experience priority:** Is gamma heatmap used on mobile? (Informs whether we need mobile-specific fixes)
4. **Force-rebuild cap headroom:** What's the acceptable p99 latency during peak market load? (Informs cap decision)

---

**Certification Sign-Off Pending:** RTH validation window results + product decisions.
**Current Status:** ⧖ **IN PROGRESS** — baseline confirmed, RTH measurements scheduled for 2026-08-24.
