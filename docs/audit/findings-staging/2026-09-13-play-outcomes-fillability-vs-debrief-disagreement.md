> **kind:** FINDING

# Night Hawk Legacy: `resolveOutcome`'s fillability gate disagrees with `debrief.ts`'s own fill logic on the exact same real historical shape — needs a product decision, not a unilateral fix

| | |
|---|---|
| **Status** | OPEN — holding per the standing escalation policy ("ambiguous/live-picks-logic → report, hold"). This changes what counts as a win/loss in the live member-facing track record; it should not be resolved by picking a side without operator/product sign-off. |
| **Surface** | `resolveOutcome` (`src/features/nighthawk/lib/play-outcomes.ts`, the LIVE mechanical outcome grader run by `resolvePendingNighthawkOutcomes`) vs. `computeFill` (`src/features/nighthawk/lib/debrief.ts`, the per-play post-mortem's own fill check) |
| **Severity** | P2 — a real, reproducible disagreement between two graders that read the SAME row fields to answer what should be the SAME question ("was this play ever fillable"), with opposite answers on the same real historical shape. Affects future grading of the exact class of play CLAUDE.md's own decision doc calls out as a real, recurring pattern (a large overnight gap through the entire published band). |

## The two implementations, side by side

`play-outcomes.ts`'s `resolveOutcome` (added under a comment titled "FILLABILITY (grading-honesty, audit MEDIUM)"):

```ts
// Range intersection: session [low, high] must overlap entry [range_low, range_high].
const fillable = low! <= row.entry_range_high && high! >= row.entry_range_low;
```

`debrief.ts`'s `computeFill` (via `fillEdgeOf`, "the level the member would actually transact at"):

```ts
const edge = fillEdgeOf(row); // LONG: entry_range_high; SHORT: entry_range_low
const reach = isLong ? bar.l : bar.h;
const filled = isLong ? reach <= edge : reach >= edge;
```

`resolveOutcome` requires the session's range to overlap BOTH sides of the band (a true set-intersection test). `computeFill` requires only that the session reach past the ONE transactable edge (LONG: does the session ever trade AT OR BELOW the band's top; SHORT: at or above the band's bottom) — a single-sided test.

These agree whenever the session gaps in the unfavorable direction (never comes back toward the band at all) or trades normally through the band. **They disagree when the session gaps favorably clean through and past the WHOLE band** — e.g. a LONG whose entire session stays below both the low AND the high of the published entry range.

## Reproduced directly against the real historical AMD 2026-07-07 shape

This exact row is `debrief.test.ts`'s own real-history anchor fixture (`AMD_0707`) — LONG $550–555 band, target 562.99, stop 550.88, session open 515.91 / high 524.97 / low 503.11 / close 516.11 (a real play that gapped ~6.55% through its own stop pre-open). `debrief.test.ts` asserts `d.fill.filled === true` for it, with the comment *"It DID fill (open below the band is fillable for a LONG)"* — and the real historical `outcome` on this row is stored as `"stop"`, not `"unfilled"`.

Feeding the identical shape directly into `resolveOutcome`:

```ts
resolveOutcome({
  direction: "LONG", entry_range_low: 550, entry_range_high: 555,
  target: 562.99, stop: 550.88,
  next_day_open: 515.91, next_day_close: 516.11,
  session_high: 524.97, session_low: 503.11,
})
// -> { hit_target: false, hit_stop: false, outcome: "unfilled", stop_data_unavailable: false }
```

`resolveOutcome` grades this exact shape `"unfilled"` — directly contradicting both `debrief.ts`'s own logic and the real, already-recorded historical outcome (`"stop"`) for the actual AMD row. (The existing AMD row itself is unaffected — it was already graded and stored before this check existed, or under different code — but any FUTURE play with this same "gap through and past the whole band" shape would now be graded differently by the two modules.)

## Why this isn't a simple pick-the-right-one fix

`play-outcomes.test.ts` already has an existing, deliberately-written test asserting the CURRENT `resolveOutcome` behavior as intended:

```ts
test("LONG that gapped BELOW its entry band and never recovered grades 'unfilled'", () => {
  const row = {
    direction: "LONG", entry_range_low: 100, entry_range_high: 104,
    target: 112, stop: 96,
    next_day_open: 88, next_day_close: 92, session_high: 93, session_low: 85,
  };
  assert.equal(resolveOutcome(row).outcome, "unfilled");
});
```

This is the SAME shape class as AMD (a LONG gapping clean through and below its entire band — and in this synthetic case, also clean through its own stop at 96, ending up at 88). So the codebase currently contains two different, both-defensible design philosophies, each with its own test asserting it as correct:

1. **Mechanical-fill philosophy** (`debrief.ts`): if a real limit/marketable order targeting the published band would have executed — including at a better price from a gap straight through the zone — the play was filled, and whatever happens next (stop/target) is graded normally.
2. **Plan-integrity philosophy** (the existing `resolveOutcome` test's implied intent): if the session gapped clean through the ENTIRE published band before the play could be entered as specified, the play "as published" was never actually tradeable at the geometry it described (its stop-to-entry risk is now completely different from what was published), so it should not count toward win/loss at all — regardless of which direction the gap ran.

Both are legitimate answers to "should this count in the track record." Which one is *intended* for Legacy's live win-rate is a product decision, not something to infer from either function's docstring alone — the two docstrings genuinely point in different directions, and neither says "and this MUST match debrief.ts / must NOT match debrief.ts."

## What this finding does NOT do

No code was changed. A draft fix (aligning `resolveOutcome` to `debrief.ts`'s single-edge philosophy) was written, verified to fix the AMD-shape reproduction, and then reverted once the conflicting existing test at `play-outcomes.test.ts` surfaced the real ambiguity — shipping it would have silently flipped this codebase's answer to "does a favorable full-band gap count as a fill" without anyone deciding that's the intended behavior, and would have deleted/rewritten a test that was clearly written on purpose.

## Recommended next step

A human/product decision on which philosophy Legacy's live track record should use, then:
- If mechanical-fill (matching `debrief.ts`): fix `resolveOutcome`'s intersection test to the direction-dependent single-edge check, update the now-contradicting `play-outcomes.test.ts` test's expected outcome (its title and assertion), and add the AMD-shape case as an explicit regression test citing this finding.
- If plan-integrity (matching the existing `resolveOutcome` test): instead fix `debrief.ts`'s `computeFill` to require the full-range intersection, correct its own `AMD_0707` fixture/test/comment (which currently asserts the opposite), and reconcile the "the entry basis is the actual conservative fill price... AMD 2026-07-07 filled at 515.91" language in `DebriefExcursion`'s own doc comment, which is written assuming the mechanical-fill philosophy.
Either direction requires touching tests that currently assert the OTHER answer — this is why it needs a decision, not a majority vote between the two files.

## Evidence

- Reproduced directly: `resolveOutcome` on the real AMD 2026-07-07 shape returns `"unfilled"`; the real historical record and `debrief.test.ts` both treat it as filled (graded `"stop"`).
- `play-outcomes.test.ts`'s own existing test (line ~109, "LONG that gapped BELOW its entry band and never recovered grades 'unfilled'") asserts the CURRENT behavior as intended, on the same shape class.
- Grepped `docs/audit/OUTCOME-GRADING-SPEC.md` for any documented resolution of this specific Legacy tension: none found (that spec covers 0DTE/Swing/Banger graders, not Legacy's `resolveOutcome`/`computeFill` pair).
