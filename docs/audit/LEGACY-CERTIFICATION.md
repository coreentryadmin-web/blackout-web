# LEGACY SYSTEM CERTIFICATION

**Date:** 2026-08-23 · **System:** Post-close digest + overnight thesis promotion  
**Status:** AUDIT IN PROGRESS — architectural analysis complete, detailed validation pending  
**Files:** Integrated with Swings (legacy-confirm-promote.ts) + Night Hawk (regrade-legacy.ts) | **Lines:** ~400 LOC

---

## EXECUTIVE SUMMARY

Legacy is BlackOut's post-close digest system. Unlike Night Hawk's intraday 0DTE discovery and Swings' thesis-based multi-day positions, Legacy operates on an **overnight decision boundary**:

1. **Evening:** Night Hawk sessions produce overnight theses (published editions with entry/stop/target bands)
2. **Morning:** `nighthawk-morning-confirm` validates overnight theses; CONFIRMED names (not pulled/INVALIDATED) are promoted to the Swings serving board
3. **Live desk:** Members see promoted theses on the Swings tab with a "NIGHT HAWK" origin badge
4. **Closing:** Thesis outcomes are graded; yesterday's session determines which theses promote to today

**Key architectural characteristics:**
- Integration point: Night Hawk overnight edition → morning-confirm verdict → Swings board
- Promotion logic: CONFIRMED theses only (not pulled/invalidated)
- Geometry re-derivation: Entry/stop/target recalculated from underlying's ATR proxy (not Legacy's overnight band)
- Grading: 0DTE-style outcome resolution (target hit, stop hit, time decay, unfilled)
- Re-grading: Legacy outcomes re-graded under current methodology to fix historical rule-set drift
- UI treatment: Distinct "NIGHT HAWK" origin badge on promoted rows
- No auto-commit: `bucketGraduated=false` — promoted theses are serve-only, not auto-executed as Swings

---

## 1. COMPONENT INVENTORY

### Promotion Logic (1 file, ~300 LOC)

| Component | File | Lines | Purpose |
|---|---|---|---|
| Promotion orchestrator | legacy-confirm-promote.ts | ~300 | Consume CONFIRMED overnight theses from edition, build swing artifacts (dossier + play + watch), merge into Swings serving snapshot with deduplication |

**Key insight:** Legacy is NOT a standalone system — it lives as a module within Swings, consuming Night Hawk's confirmed overnight data and injecting it into the live board.

### Re-grading Logic (1 file, ~180 LOC)

| Component | File | Lines | Purpose |
|---|---|---|---|
| Legacy re-grading | regrade-legacy.ts | ~180 | Re-run current outcome rules over legacy-methodology resolved rows, preserving old grades verbatim, idempotent so promoted rows never re-grade twice |

**Key insight:** Legacy re-grading is a DATA REPAIR tool, not part of the live flow. It fixes historical rule-set drift by re-applying current rules to rows graded under old methodology.

---

## 2. OVERNIGHT THESIS PROMOTION ARCHITECTURE

### Promotion Decision Boundary

**Input:** Night Hawk's published overnight edition (contains theses for next-day morning)

**Filter:** Morning-confirm verdict per thesis
- CONFIRMED: Thesis passes overnight validation; promote to Swings board
- PULLED: Member manually removed the thesis overnight; do not promote
- INVALIDATED: Cortex or firewall vetoed the thesis; do not promote

**Output:** Promoted swing artifacts (dossier, play, watch) merged into live Swings snapshot

### Artifact Construction

**Inputs to promotion** (per confirmed thesis):
1. Overnight PlaybookPlay (entry band, stop, target, score, flow_streak_days, iv_rank)
2. Current spot price
3. Option chain rows (for contract selection)
4. (Optional) Multi-day underlying closes for ATR proxy

**Artifact assembly:**

#### 1. Dossier (SwingDossier)
- Directional reads synthesized from play's flow data:
  - Accumulation: direction + strength grounded in play.score (40–100 synthetic range)
  - Flow window: play.flow_streak_days + 2
  - Structural reads: EMA stack aligned with direction (LONG → all EMA up; SHORT → all down)
  - Volatility/regime: Constant scaffold (dataQuality downgraded to 0.55 to reflect edition-grounded reads)

#### 2. Plan Levels (entry/stop/target geometry)
**Primary path** (when daily closes available):
- Use `planFromCloses`: Call `deriveSwingPlanLevels` (the organic Swing discovery path)
- Ground in underlying's ATR proxy from recent multi-day bars
- 1.5×ATR stop, 2.7×ATR target (identical to organic discovery)
- **WHY:** Overnight band is sized for a next-day 0DTE-adjacent hold, not a genuine 2–30 DTE swing. Research shows 16/48 failures were `target_unreachable` and 9/48 were `unfilled_never_traded_back` under old levels (FINDINGS 2026-08-06 P2).

**Fallback path** (when no daily closes available):
- Use `planFromLegacyLevels`: Parse play's published entry/stop/target band
- Derive ATR from stop distance (stop = entry − 1.5×ATR)
- Return the published band as geometry
- **NOTE:** This is fallback only, never primary, so a data fetch miss doesn't blank a session.

#### 3. Horizon Play (HorizonPlay)
- Score: Use play.score if available, else organic dossier score
- Origin badge: `signalKinds: ["NIGHT HAWK"]`
- Setup state: Reason annotated with `Legacy morning confirm (${editionFor})`
- **Serve-only:** `bucketGraduated=false` — no auto-commit (thesis is on the board but not a pending position)

#### 4. Watch Candidate (SwingWatchCandidate)
- Thesis key: (ticker, direction, archetype)
- Observation count: Set to LEGACY_PROMOTED_MIN_SESSIONS (2) — synthetic count to satisfy persistence gate
- Distinct session days: Also 2 (synthetic, representing "overnight validation counts as 2 sessions")
- Phases seen: ["PRE_OPEN"] (morning check-in, not live discovery)
- Signal kinds: ["NIGHT HAWK"] (origin badge)

**Deduplication:** Merge additions into serving snapshot, skip if thesis key already exists (existing rows win, idempotent).

---

## 3. OVERNIGHT OUTCOME GRADING ARCHITECTURE

### Outcome Resolution

**Input per promoted thesis:**
- PlaybookPlay details (entry band, stop, target)
- Overnight session OHLC
- Next-day (promotion day) OHLC
- Market behavior: whether entry band was touched, stop was hit, target was reached

**Grading rules** (same as 0DTE, via `resolveOutcome`):
- **target:** Close(next-day) ≥ target OR (entry band was reachable AND reached target level)
- **stop:** Low(next-day) ≤ stop
- **open:** Neither target nor stop hit; position still in thesis band
- **unfilled:** Entry band was never traded back into (gapped away, never touched)
- **ambiguous:** Conflicting signals (both target and stop hit in same bar? Rare edge case)

**Key insight:** Outcome resolution uses the SAME rules as Night Hawk. A promoted thesis grades using 0DTE logic once it's on the board.

### Legacy Re-grading (Historical Repair)

**Problem:** Earlier legacy outcomes were graded under different rules than current 0DTE. When rules change, old rows carry old grades. The distinction leaks into analytics (win-rate tracking includes a mix of old and new methodologies).

**Solution:** `regradeLegacyNighthawkOutcomes` re-runs current rules over persisted row data:
1. Find all legacy-methodology resolved rows (outcome != "pending" AND grade_methodology != CURRENT)
2. For each row, call `resolveOutcome(row)` — the CURRENT rules, applied to the row's own persisted bars
3. Persist the current verdict, preserving the old grade verbatim in `legacy_grade` column (first-write-wins)
4. Stamp the row with CURRENT methodology tag so it never re-grades again (idempotent)
5. Report changed rows (signature: old='target', new='unfilled' = phantom win, the most common drift)

**Bounded:** Limit (50 default, 200 max), search window (90 days default, 365 max), dry-run mode.

**Idempotent:** A row stamped CURRENT is excluded by the fetch selector, so re-running the same regrade produces 0 regraded.

---

## 4. DATA FLOW & INTEGRATION POINTS

### End-to-End Flow

```
Night Hawk Evening        →  Overnight Edition
                             (entry/stop/target, score, flow data)
                                     ↓
Morning (RTH −15min)      →  nighthawk-morning-confirm
                             (validate theses, mark CONFIRMED/PULLED/INVALIDATED)
                                     ↓
Swings Morning Board      →  CONFIRMED theses promoted
                             (legacy-confirm-promote builds artifacts)
                             (served with "NIGHT HAWK" badge)
                             (bucketGraduated=false, no auto-commit)
                                     ↓
Live Desk (Members)       →  Swings panel shows promoted rows
                             (optional manual entry into live positions)
                                     ↓
Session Close             →  Outcomes graded
                             (resolveOutcome applied to promoted theses)
                                     ↓
Overnight / Next Day      →  Re-grading (optional)
                             (regradeLegacyNighthawkOutcomes fixes old methodology)
```

### Cross-System Dependencies

1. **Night Hawk → Legacy:** Overnight theses, morning-confirm verdict
2. **Legacy → Swings:** Promoted artifacts injected into serving snapshot
3. **0DTE grading → Legacy grading:** Outcome resolution rules identical
4. **DB schema:** nighthawk_play_outcomes (grade_methodology column tracks which rule set graded a row)

---

## 5. KNOWN DESIGN DECISIONS & TRADE-OFFS

### Geometry Re-derivation (FINDINGS 2026-08-06 P2)

**Decision:** Always re-ground promoted thesis levels in the underlying's ATR proxy (when available).

**Rationale:** Overnight entry/stop/target bands are sized for next-day 0DTE-adjacent holds (tight, fast), not multi-day swing holds. Empirical failure modes showed 16/48 target unreaches and 9/48 unfilled entries under old levels over 30-day grading window.

**Trade-off:** If daily closes are unavailable (data miss, provider outage), fallback to legacy levels. This is honest (a data miss is a data miss) but the geometry degrades to next-day-sized levels.

### Observation Count Synthetic (LEGACY_PROMOTED_MIN_SESSIONS=2)

**Decision:** Promoted theses are assigned `observationCount=2` and `distinctSessionDays=2` (synthetic).

**Rationale:** Morning confirmation is a SECOND validation (after overnight discovery), satisfying the anti-lone-print persistence gate. A thesis that CONFIRMED is not a lone sighting.

**Trade-off:** The "2" is synthetic, not from live accumulation-store observation. This allows a promoted thesis to behave as a multi-day persistent thesis even though it's really a 1-observation (overnight) input.

### Serve-Only, No Auto-Commit (bucketGraduated=false)

**Decision:** Promoted theses appear on the Swings board but do NOT auto-commit as live positions.

**Rationale:** Morning confirm validates the thesis but doesn't commit capital. Members can opt in to live positioning if they choose, but the system doesn't commit on their behalf.

**Trade-off:** Requires members to manually action a promoted thesis if they want to trade it. No firewall gates the initial promotion (it's the morning-confirm verdict that gates it), but there's no second gate at commit time.

---

## 6. VALIDATION STATUS

### ✅ COMPLETED (Architectural)

- Component mapping (2 core modules + integration points)
- Promotion decision boundary (CONFIRMED/PULLED/INVALIDATED filter)
- Artifact construction (dossier, play, watch synthesis)
- Geometry re-derivation logic (ATR proxy vs legacy levels fallback)
- Outcome grading rules (0DTE-compatible resolution)
- Re-grading repair logic (methodology tracking, idempotent promotion)
- Cross-system data flow documented

### ⏳ PENDING (Detailed Validation)

| Item | Method | RTH Required |
|---|---|---|
| Promotion accuracy | Audit sample of 10–15 promoted theses: were they CONFIRMED (not PULLED/INVALIDATED)? | Yes |
| Geometry re-derivation | Spot-check promoted levels: do ATR-derived levels match organic discovery geometry? | No |
| Outcome grading agreement | Compare legacy-graded outcomes vs current-rules outcomes on 20–30 sample rows | No |
| Artifact deduplication | Verify thesis-key dedup works (no duplicates in watch/plays snapshots) | No |
| Morning confirm handoff | Trace one CONFIRMED thesis through morning-confirm to serving snapshot | Yes |
| Re-grading idempotence | Run regrade twice, verify second run produces 0 regraded | No |
| Re-grading changed-row detection | Inspect sample of re-graded rows; report old→new outcome pairs (phantom-win signature) | No |

---

## 7. KNOWN RISKS & OBSERVATIONS

### High Risk

1. **Geometry re-derivation quality:** When daily closes are unavailable, fallback to legacy levels. Is this case monitored/alerted? Silent fallback to worse geometry could bias session outcomes.
2. **Outcome grading drift:** If 0DTE rules change (e.g., fillability re-assessment, new stop logic), legacy outcomes may need re-grading again. Is there a process to detect / re-run the re-grading?
3. **Morning-confirm verdict stability:** If a thesis is CONFIRMED overnight but INVALIDATED by Cortex at morning check-in, does the promotion still fire, or is there a second gate? (Current code appears to fire on CONFIRMED, no second gate.)

### Medium Risk

1. **Synthetic observation count:** The "2" observation count is fabricated, not measured. If accumulation-store logic changes (e.g., new persistence rule), promoted theses won't adapt (they're hardcoded to 2).
2. **Serve-only no-commit:** Members must manually action a promoted thesis. If adoption is low, the system may promote theses that never trade, biasing the grading record toward conservative outcomes.
3. **Geometry scaling:** A promoted thesis from overnight (sized for day-trading) is being held for 2–30 DTE. Stop/target may be too tight for swing holds. Is the trade-off intentional?

### Low Risk

1. **Artifact synthesis:** Dossier, play, watch construction is straightforward and well-documented. No complex logic.
2. **Idempotent upsert:** Promotion merge uses thesis-key dedup (existing rows win), fail-soft and safe.
3. **Re-grading bounded:** Limits and search windows prevent runaway jobs.

---

## 8. NEXT AUDIT STEPS

### Immediate (No RTH)
1. **Promotion accuracy audit:** Manually inspect 10–15 promotion records (did promotion happen for CONFIRMED theses only?)
2. **Geometry audit:** Spot-check 5–10 promoted theses; verify ATR-derived levels vs organic discovery levels match
3. **Artifact deduplication audit:** Inspect serving snapshot; verify no duplicate thesis keys in watch/plays
4. **Re-grading audit:** Run regrade on 30-day window, report changed-row signatures (old→new outcome pairs)

### RTH-Dependent
1. **Morning-confirm handoff audit:** Watch one morning confirm session; trace a CONFIRMED thesis from edition → morning confirm → serving snapshot
2. **Promotion coverage audit:** Measure % of morning-confirmed theses that actually promote (success rate)
3. **Member adoption audit:** Track how many promoted theses are manually actioned by members (uptake rate)

---

## 9. ARCHITECTURAL ASSESSMENT

### Strengths
- **Clear integration boundary:** Night Hawk produces overnight data, morning-confirm gates promotion, Swings serves/grades
- **Faithful outcome grading:** Uses 0DTE's proven resolveOutcome rules, no new/custom grading logic
- **Geometry re-derivation:** Fixes the next-day-sized band problem with ATR proxy grounding
- **Idempotent architecture:** Dedup by thesis key, first-write-wins, safe to retry
- **Audit-friendly:** Re-grading is bounded, dry-runnable, preserves history (first-write-wins on `legacy_grade`)

### Complexity Hotspots
- **Overnight data handoff:** Morning-confirm verdict must gate promotion correctly (CONFIRMED/PULLED/INVALIDATED logic)
- **Geometry fallback:** When closes are unavailable, geometry degrades silently (should be monitored/alerted)
- **Synthetic counts:** observationCount=2 is fabricated, not measured from accumulation store
- **Outcome rule coupling:** Legacy outcome grading is identical to 0DTE; a change to one requires re-grading the other

---

## CERTIFICATION CHECKLIST (LEGACY)

| # | Criterion | Status | Notes |
|---|---|---|---|
| 1 | Inventory everything | ✅ | 2 core modules, integration with Night Hawk + Swings documented |
| 2 | Validate every number | ⏳ | Requires outcome-grading audit (old vs current methodology) |
| 3 | Validate every label | ⏳ | Origin badge, outcome labels, signal kinds need verification |
| 4 | Validate every panel | ⏳ | Legacy rows rendering in Swings panel (if exposed); origin badge visual |
| 5 | Test every interaction | ⏳ | Member interaction with promoted theses (if exposed) |
| 6 | Validate the logic | ⏳ | Promotion decision boundary, geometry re-derivation, grading agreement |
| 7 | Audit the architecture | ✅ | Architecture review complete; risks identified |
| 8 | Performance certification | ⏳ | RTH performance measurement pending (promotion latency, coverage, grading cadence) |
| 9 | Product & UX review | ⏳ | Legacy row visibility, origin badge clarity, manual-action friction |
| 10 | Find new features | ⏳ | Potential: auto-promote to positions, smart entry timing, smart exit scaling |
| 11 | Competitive review | ⏳ | Compare overnight-to-next-day promotion vs tastyworks, TD, other platforms |
| 12 | Find what wasn't asked | ⏳ | New features: overnight-thesis calibration, morning-confirm criteria refinement? |
| 13 | Produce matrix | THIS DOCUMENT | Legacy certification section added |

---

**Last updated:** 2026-08-23 21:45 UTC  
**Certification owner:** Claude Night Hawk lane  
**Next step:** Promotion accuracy + geometry audit (no RTH needed), then RTH morning-confirm handoff trace
