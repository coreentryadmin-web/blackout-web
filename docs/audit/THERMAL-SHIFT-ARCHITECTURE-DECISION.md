# THERMAL SHIFT ARCHITECTURE DECISION FRAMEWORK

**Status:** Awaiting product decision  
**Context:** Certification audit finding (THERMAL-CERTIFICATION.md §Major Issues)  
**Impact:** Affects interpretation of shift metrics on SPX; determines scope of Phase 1 recompute work

---

## The Inconsistency

On SPX, the heatmap carries two conflicting reference points:

| Aspect | Current State | Reference |
|---|---|---|
| **GEX levels** (strike_totals, flip, regime, walls) | UW-dealer-overlaid book | Post-overlay recompute in `spx-odte-gex-uw-overlay.ts:148` |
| **GEX shift** (delta from prior snapshot) | Raw Polygon book | Pre-overlay snapshot in `polygon-options-gex.ts:3506-3519` |
| **VEX/DEX/CHARM totals & shifts** | Raw Polygon book (all untouched by overlay) | Same pre-overlay snapshot |

**Member perspective:** A trader sees the overlaid GEX levels on screen. The shift describes deltas in a DIFFERENT book (raw Polygon), creating a mismatch: "the wall moved up 50 points" (shift) while "the wall is now here" (level) describe different sources.

---

## Two Design Intentions

### Option A: Shifts as Market Structure Signal

**Thesis:** Shifts show "how the underlying market structure changed," independent of how we present it.

**Approach:** Keep current implementation — shifts measure RAW Polygon book deltas.

**Rationale:**
- Raw deltas answer: "What changed in the actual options market?"
- UW overlay is a presentation layer for dealer positioning; it shouldn't hide market changes
- Historical consistency: shift snapshots in Redis ring describe raw data; rewriting them post-overlay breaks continuity
- Cost: zero (no recomputation needed)

**Tradeoff:**
- Shift and levels describe different books; member must understand they're different signals
- Shift on SPX doesn't correlate with visible level changes (overlay disrupts correlation)
- Largo receives both raw-shift and overlaid-levels without field to disambiguate

**Example (SPX RTH):**
- UW ladder replaces Polygon 0DTE column, shifts levels up 100 points
- Raw GEX shift says: "no change" (market didn't move, we just re-scored it)
- Member reads this as: "why no shift when I see the wall move?"

### Option B: Shifts as Dealer Positioning Signal

**Thesis:** Shifts show "how the dealer positioning we're serving changed."

**Approach:** Recompute GEX/VEX/DEX/CHARM shifts AFTER overlay, using overlaid strike_totals.

**Rationale:**
- Shifts correlate with visible level changes (same book, same snapshot)
- Single reference point: everything describes the book the member sees
- Largo receives aligned deltas and levels
- Matches user expectation: "if the wall moved, shift reflects it"
- Cost: ~15ms per force-rebuild (recompute shifts on overlaid data)

**Tradeoff:**
- Breaks historical continuity in shift snapshots (pre/post-overlay snapshots have different semantics)
- Overstates market movement: a pure overlay (no market change) reads as shift deltas
- Redis ring would need per-snapshot metadata: `{snapshot, shift_basis: 'raw' | 'overlaid'}`
- On VEX/DEX/CHARM, no overlay exists, so they'd still be raw—creating asymmetry

**Example (SPX RTH, same scenario):**
- UW ladder replaces Polygon 0DTE, shifts levels up 100 points
- Recomputed GEX shift says: "up 100 points" (reflecting the overlaid data)
- Member reads: "ah, dealer positioning shifted" (aligned with visible change)

---

## Hybrid Option C: Dual Signals (Documented Distinction)

**Approach:** Keep raw shifts, but add metadata field distinguishing basis per ticker/metric.

**Fields added:**
- `shift.basis: 'raw' | 'overlaid'` per metric
- Lungo tools document: "On SPX, GEX shift measures raw Polygon book; VEX/DEX/CHARM unchanged"
- Member UI caveat: "Shift measures market structure (raw book); levels show dealer positioning"

**Cost:** ~5ms per build (field addition only, no recompute).

**Tradeoff:** Clarity but double work (two signals to watch); may confuse rather than clarify.

---

## Measurement Needed

Before deciding, **measure during RTH** (2026-08-24 09:30–16:00 ET):

1. **Frequency:** How often does the UW overlay actually change GEX deltas? (Pure column replacement with no market-side change vs. real dealer repositioning)
2. **Magnitude:** When overlay does shift levels, how much (typically) and how visible to a trader?
3. **Correlation:** Do members use shift as a trading signal? Or is it supplemental context?

**Quick proxy:** Run `scripts/audit/gex-force-rebuild-timing.mjs` on SPX during RTH; the rebuild includes overlay. If rebuild mostly happens on portfolio shifts (dealer moving), Option B (recompute) costs more. If it's noise (pure market pagination), Option B matters less.

---

## Recommendation

**Option A (Keep raw shifts) + documentation caveat is lowest-risk:**
- No recomputation cost
- Historical continuity preserved
- Honest about signal origin
- Requires member education in UI / Largo docs

**Option B (Recompute post-overlay) if correlation matters:**
- True if members actively use shift as a trading signal
- Cost is acceptable (~15ms per force-rebuild)
- Requires Redis schema bump and shift basis tracking

**Option C (Dual signals) only if Option A + docs prove insufficient.**

---

## Decision Template

Product answer needed:

> On SPX, should shifts represent:
>
> (A) Market structure change (raw Polygon deltas) — levels and shifts measure different books
> (B) Dealer positioning change (post-overlay deltas) — levels and shifts measure the same book
> (C) Both with metadata — add `shift.basis` field, document distinction
>
> Context: (A) = zero cost, (B) = ~15ms per rebuild, (C) = ~5ms + double signal.

---

## Files Affected by Decision

### Option A (no change)
- No code changes needed

### Option B (recompute)
- `src/lib/providers/spx-odte-gex-uw-overlay.ts`: Add shift recompute in `recomputeNearTermGexStrikeTotals` (parallel to regime/flip recompute already there)
- `src/lib/providers/polygon-options-gex.ts`: Document that SPX shifts describe overlaid state
- Redis schema: ensure shift snapshots carry metadata if needed

### Option C (document)
- `src/lib/public-gex-snapshot.ts`: Add `shift.basis` field
- `src/lib/largo/contract/product-read.ts`: Document basis in Largo contract
- Member UI tooltips: explain "shift measures market structure"

---

## Timeline

- **Decision:** Needed before Phase 1 follow-up PRs merge
- **RTH measurement:** 2026-08-24 09:30–16:00 ET (confirms decision)
- **Implementation:** 1–2 PRs depending on option chosen
