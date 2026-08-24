# HELIX Phase 1 Items 7-9 — Frameworks & Coordinator Decisions

**Date**: 2026-08-24  
**Status**: BLOCKED ON EXTERNAL DECISIONS & RUNTIME MEASUREMENTS  
**Kind**: FINDING

---

## Summary

Items 7-9 are infrastructure and decision-based work remaining after Items 1-6 code fixes are complete. Two items require runtime validation (Items 7-8), one requires coordinator judgment (Item 9 with two independent sub-decisions).

---

## Item 7: Interaction Harness for HELIX /flows Panel

### Current Status
**FRAMEWORK COMPLETE** — `scripts/audit/helix-interaction-audit.mjs` ready for deployment

### What It Does
Comprehensive UI/UX interaction validation across all five HELIX panels:
- **Overlap detection** — any two text nodes physically intersecting on screen
- **Clipping detection** — text cut off by its container
- **Tap target validation** — controls smaller than 24px
- **Panel state preservation** — selection survives panel switching + reload
- **Keyboard navigation** — tabs accessible without mouse
- **Deep link survival** — reloading on a selected ticker restores selection
- **Network validation** — detects non-2xx/3xx requests, duplicated fetches
- **Console errors** — any errors logged during interaction
- **Truncation flags** — verifies `_truncated` and `_total` count fields match rendered rows
- **Data flow validation** — signal flags match actual rendered data

### Blocker
**Infrastructure requirement** — Not a code change. Requires:
1. Deployment to blackout-infra (adds to deployment checklist)
2. Scheduler to run during market hours (9:30 AM - 4:00 PM ET, weekdays)
3. One temp Clerk premium user per run (created/deleted automatically)

### Framework Deployment
```bash
# Run from REPO ROOT with NODE_USE_ENV_PROXY=1:
NODE_USE_ENV_PROXY=1 node scripts/audit/helix-interaction-audit.mjs \
  [--base=<url>] \
  [--viewport=desktop|mobile]
```

**Expected output**: GREEN if all checks pass, RED with failed-checks list if any fail. Gated on PAGE-LOADED proof (harness verdicts for blank pages, 404s, auth bounces).

### Next Step
**Item 7 can proceed independently** after Items 1-6 merge. No blocker on this one — infrastructure only.

---

## Item 8: Re-run Tape Inventory During RTH

### Current Status
**FRAMEWORK COMPLETE** — `scripts/audit/helix-rth-measurement.mjs` ready for RTH execution

### What It Does
Re-measures HELIX tape inventory during Regular Trading Hours to confirm weekend baseline holds under live market conditions:

**Baseline (2026-08-22, weekend/settled tape):**
- Signal eligibility: 30% (SPX/SPY parse bug — fixed in #2723)
- Writer group split: 1500 (Group A/UW) vs 3500 (Group B/SPX-SPY index)
- Route breakdown: 98.8% OTHER, 1.2% FLOOR, 0.1% SWEEP
- GEX proximity: 2.2% when ~100-ticker cap engages
- IV distribution: median 0.17, max 106.2 (should be 0-1 fractional)
- Real-print span: 168h window

**Expected RTH Changes (post #2723 fix):**
- Signal eligibility: 100% (fix should eliminate parse bug)
- GEX proximity: ~15% (warm cache + live market)
- IV distribution: unimodal, fractional (0-1)
- Route vocabulary: REPEAT may appear (frequency TBD)

### Blocker
**Runtime requirement** — Must run during market hours (13:30-20:00 UTC = 9:30 AM - 4:00 PM ET) to validate live conditions. Cannot be run off-hours.

### Framework Execution
```bash
# Run from REPO ROOT during RTH with NODE_USE_ENV_PROXY=1:
node scripts/audit/helix-rth-measurement.mjs --compare --json

# Or invoke helix-tape-inventory.mjs directly for full measurement:
node scripts/audit/helix-tape-inventory.mjs --json > rth-measurement.json
# Then compare against baseline in docs/audit/ directory
```

**Expected output**: Comparison against 2026-08-22 baseline with signal_eligible_pct = 100% confirmation.

### Next Step
**Item 8 requires scheduling** for the next market-open session. Coordinator should assign a date/time when RTH validation can run to collect live measurement.

---

## Item 9: §9.7 Score Saturation & §9.1 Cron Scheduling

### Current Status: §9.7 HELIX Score Saturation
**MEASURED 2026-08-23** — Conviction score does NOT rank directional follow-through.

#### Evidence
- Sample: 748 prints graded across 30/60/180min horizons
- Win rates by bucket: **all between 41-53% (coin flip range)**
- Best bucket **changes at each time horizon**
- Rank correlation: **ρ = +0.40 at 30min, ρ = −0.40 at 60min (flips sign)**
- **Verdict**: `SPREAD WITHOUT ORDER` — score has breadth but no ranking

#### Root Cause
```
score = min(60, premium/$1M × 60) + sweep(25) + 0dte(15)
```
The `min(60, ...)` caps every print ≥ $1M at the same 60 points. **Only 11.2% of prints score above 59**, so the top 40% of the range is empty. Large and small orders within the $1M+ cohort are indistinguishable by score.

#### Coordinator Decision: Three Paths Forward

**A) Leave as-is** ✓ RECOMMENDED if score's use case is "tiebreaker"
- Score is a display heuristic, not a ranking claim
- Does not prevent other signals (direction, velocity, split flow) from working
- Safe — no change = no regression risk
- Member still sees relative ranking by score (even if score doesn't predict follow-through)
- **Choose this if:** score's intended use is "tiebreaker for equal-importance prints"

**B) Rescale the premium term**
- Remove `min()`, so large orders create separation
- Would populate the top of the range (above 60)
- Risk: Might concentrate too much weight on size alone
- Requires testing: would high-score prints then rank better than flat 41-53%?
- **Choose this if:** score should predict follow-through directions
- **Note:** This is the intuition-driven change §9.7 forbids without evidence. Evidence can now be gathered with a B/A test.

**C) Drop numeric score for explicit ranked label**
- Replace "50" with "medium", "high", "very high" etc.
- Avoids false precision
- Cleaner to read
- Cannot be sorted numerically in UI (would need redesign)
- **Choose this if:** numeric precision is misleading and labels are sufficient

---

### Current Status: §9.1 HELIX Signal Outcomes Cron Scheduling
**BLOCKED** — Cron registered in code but absent from deployment.

#### Evidence
- `src/lib/cron-registry.ts` line 123: `helix-signal-outcomes` fully registered
- Schedule: ~Every 15 min (market hours), weekdays only
- Intended to write `helix_signal_outcomes` table (the measurement instrument for §9.7)
- **Missing from**: `blackout-infra/cron-jobs.json` (verified 2026-08-23)

#### Impact
- Signal outcomes ledger has no writer
- §9.7 grading used offline proxy (bar-based measurement) instead
- No historical record of when each velocity spike or split flow signal fired
- Cannot verify signal detector's own calibration without the ledger

#### Two Possible Reasons

**Reason 1: Intentional — Feature not yet ready**
- The cron was registered in advance but deployment was deferred
- Might be waiting on: signal ledger schema finalization, detector calibration, or approval
- Requires: Coordinator to confirm if/when to deploy

**Reason 2: Accidental — Disappeared during manual Terraform drift**
- The ledger was originally deployed, then manually removed to save cost or due to misconfiguration
- Requires: Coordinator to check Terraform state and deployment history

#### Coordinator Decision: Three Paths Forward

**A) Deploy now** ✓ ENABLES LIVE MEASUREMENT
- Enables live measurement and verification of signal detectors
- Captures signal history for post-analysis
- Cost: ~5-10 rows per signal instance, ~100-200 rows/day
- Timeline: 1 deploy (~5 min) plus ~2h of signal accumulation before data is usable
- **Choose this if:** signal detector calibration is ready or can proceed in parallel
- **Impact on §9.7:** After ~2h, can re-run `helix-score-signal.mjs` with live ledger data to confirm offline measurement

**B) Hold deployment pending review**
- Reasonable if signal detector calibration is still in flux
- §9.7 measurement can proceed via offline method (already proven)
- Timeline: Can resume anytime coordinator approves
- **Choose this if:** you want to review detector behavior before writing a ledger

**C) Don't deploy**
- Saves cost and operational surface area
- §9.7 and future signal validation must use offline measurements
- Acceptable if signals are deemed "working as intended"
- **Choose this if:** you accept offline-only signal validation as permanent

#### Deployment Steps (if choosing Option A)

1. Confirm route exists: `/app/api/cron/helix-signal-outcomes` ✓ (verified in prior session)
2. Confirm cron schedule in registry: ~15min, market hours ✓ (verified)
3. Deploy to blackout-infra: add entry to `cron-jobs.json`
4. Verify: Route returns 2xx and inserts rows
5. Timeline: ~2h wait for sufficient data, then re-run §9.7 grading with live data

---

## Coordinator Action Items

### For §9.7 Score Saturation
**What is the score's intended use case?**
- If: "Relative ranking of equal-weight prints" → **Choose A (leave as-is)**
- If: "Primary directional confidence measure" → **Requires B or C** (current score is insufficient)
- If: Unsure → **Choose A and gather evidence** on option B with a B/A test

### For §9.1 Cron Scheduling
**Should helix-signal-outcomes be deployed to production?**
- **Option A**: Deploy now (enables live measurement, ~5-10 min setup + 2h data collection)
- **Option B**: Hold pending review (§9.7 proceeds offline, can resume anytime)
- **Option C**: Skip deployment (accept offline-only signal validation)

---

## Remaining Work Schedule

**If Deploying Cron (Option A on §9.1):**
1. Deploy `helix-signal-outcomes` cron to blackout-infra
2. Wait ~2h for signal accumulation
3. Re-run `helix-score-signal.mjs` with live ledger data
4. Compare against offline measurement (should agree)
5. Consider retrying Option B (rescale) with evidence if offline result stands

**If Not Deploying (Option C on §9.1):**
1. Document that signal outcomes are measured offline only
2. Update Item 9 status to note ledger is not live

**For Item 7 (Interaction Harness):**
- Deploy framework to blackout-infra scheduling
- Run during next RTH window for full UI validation

**For Item 8 (RTH Measurement):**
- Schedule measurement during next market-open session
- Confirm baseline hypothesis: 100% signal eligibility post-#2723

---

## Summary Table

| Item | Status | Decision Needed | Blocker |
|---|---|---|---|
| 7: Interaction Harness | ✅ FRAMEWORK READY | Infrastructure/scheduling | No — can deploy independently |
| 8: RTH Measurement | ✅ FRAMEWORK READY | Runtime execution | No — schedule during next RTH |
| 9a: Score Saturation | ✅ MEASURED | A/B/C decision | No — proceeds independently |
| 9b: Cron Scheduling | 🚫 BLOCKED | Deploy A/B/C | No — needs coordinator approval |

---

## Quick Reference: Decision Template

**For Coordinator:**

> **§9.7 Score Saturation:** I measured the score and found it doesn't rank — 41-53% win rates across all buckets. Three options:
> - **A** Leave it (safe, score works as display heuristic)
> - **B** Rescale premium term to separate large/small orders
> - **C** Replace with ranked label ("high"/"medium"/"low")
>
> Choose A if score's use case is "tiebreaker". Choose B/C if score should predict follow-through.

> **§9.1 Cron Scheduling:** The signal-outcomes cron is in code but not deployed. Deploy it to enable live measurement, or skip it and accept offline-only signal validation.
>
> **A** Deploy now (~5 min + 2h data)  
> **B** Hold pending review  
> **C** Skip deployment

