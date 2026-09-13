> **kind:** FINDING

# Night Hawk Legacy: `resolveOutcome`'s fillability gate disagrees with `debrief.ts`'s own fill logic on the exact same real historical shape — needs a product decision, not a unilateral fix

| | |
|---|---|
| **Status** | OPEN — holding per the standing escalation policy ("ambiguous/live-picks-logic → report, hold"). This changes what counts as a win/loss in the live member-facing track record; it should not be resolved by picking a side without operator/product sign-off. **Updated twice, same day:** (1) found the deliberate design history (N-2, `grade-methodology.ts`) behind `resolveOutcome`'s behavior; (2) got live data + found `debrief.ts` always defers to `resolveOutcome`'s persisted outcome for every aggregate/failure-mode tag, so the two never actually disagree on a LIVE stat today — see the Update sections below. Still OPEN; evidence trail is fuller, severity is narrower than originally scored, decision is still not made. |
| **Surface** | `resolveOutcome` (`src/features/nighthawk/lib/play-outcomes.ts`, the LIVE mechanical outcome grader run by `resolvePendingNighthawkOutcomes`) vs. `computeFill` (`src/features/nighthawk/lib/debrief.ts`, the per-play post-mortem's own fill check) |
| **Severity** | P3 (downgraded from P2 — see Update 2) — a real, reproducible logic disagreement between two functions that read the same row fields, but `debrief.ts` never lets `computeFill` override `resolveOutcome`'s persisted verdict in any live aggregate, so this is not currently a live cross-module contradiction — only a latent inconsistency that affects FUTURE grading of a real, recurring shape (a large overnight gap through the entire published band; 23 currently-unfilled non-pulled rows in the live 90-day record). |

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

## Update (same day, later cycle): found the decision history behind `resolveOutcome`'s design — it deepens, not resolves, the question

Improvement-hunting the same lane later this session surfaced `grade-methodology.ts` and
`docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md` (PR-N2, 2026-07-14) — neither was checked before this
finding was originally written. They show `resolveOutcome`'s full-band-intersection ("plan-integrity")
behavior is **not an accidental design** — it was shipped deliberately, with real measured evidence,
specifically to kill a "phantom win" pattern: bucketing the app's 14 then-resolved plays by
"open-beyond-band", the gapped-away group graded **6 target / 1 stop, +5.11% avg (100% of the
record's wins)** while genuinely fillable plays graded **0 target / 4 stop, −1.39% avg**. The
`"unfilled"` verdict for a full-band gap-through exists specifically so a play that was never really
enterable at its published entry can't mint a win it didn't earn. On the *gap-through-to-a-win* side,
`resolveOutcome`'s plan-integrity philosophy is the one with real evidence behind it, not an
arbitrary or equally-weighted alternative to `debrief.ts`'s mechanical-fill.

**But that evidence is one-directional, and this finding's own AMD reproduction is the other
direction — which N-2 never measured.** N-2's dataset bucketed by whether the gap-through row graded
a WIN; it never asked the mirror question: does blanket-excluding every full-band gap-through row
*also* exclude real, gap-through LOSSES (like this finding's AMD case, which historically graded
`"stop"` — a loss) from the win/loss denominator? Excluding a genuine loss from the denominator is
not symmetrically conservative the way excluding a phantom win is — it can *inflate* the reported win
rate by shrinking the denominator on the loss side while the win side (already fixed by N-2) stays
protected. N-2's own historical numbers hint at how large this could be: of the 26 plays published as
of 2026-07-14, only 14 were app-resolved at all, and re-grading all 26 under current
`resolveOutcome` rules produced **1 target / 5 stop / 3 open / 17 unfilled** — a large `"unfilled"`
bucket that N-2's analysis never split by "would this have graded a loss under debrief.ts's
mechanical-fill logic." That 17-of-26 figure is now two months stale (this session's live
`healthcheck:legacy` reports `resolved=26` today, a different cohort) and unauthenticated access
to `GET /api/market/nighthawk/record` from this sandbox returned 401 rather than the real current
breakdown, so this could not be re-measured live this cycle.

**Net effect on the recommendation:** this does not resolve the finding — plan-integrity is now
better-evidenced on the phantom-win side, but the *product decision* the original finding calls for
is unchanged, and is now sharper: whoever decides should also see whether the current `"unfilled"`
population contains asymmetric loss-exclusion, not just re-litigate the win-side case N-2 already
settled. **Recommended follow-up measurement** (not attempted here — needs authenticated access to
the live record, which this sandbox could not obtain this cycle): for every currently-`"unfilled"`
graded row, replay it through `debrief.ts`'s `computeFill`/mechanical-fill logic and split the result
by whether it would have graded a win or a loss. If the unfilled bucket skews toward loss-shaped rows
being excluded, that is independent evidence for tightening `resolveOutcome` (or for debrief.ts's
computeFill to gain a matching band-integrity mode) beyond what N-2 alone shows. No gate/grading
logic changed by this update — still OPEN, still holding for a product decision, now with the fuller
evidence trail in one place.

## Update 2 (same day, next cycle): the 401 was a self-inflicted usage bug; got live data — and a real severity downgrade

The previous update's "could not obtain authenticated access" was this session's own mistake, not a
real access limit: `fetchAuditJson(base, path)` (`scripts/audit/lib/audit-auth-fetch.mjs`) takes
`base` and `path` as **two separate arguments**; the prior attempt passed one concatenated URL as
`base` with `path` undefined, which 401'd. Corrected, it authenticates cleanly (`via: "cron"`).

**Live `GET /api/market/nighthawk/record?days=90` (2026-09-13):** current segment (`v2_fillability`,
resolved 141, opens 86) — `unfilled: 25`, `pulled: 27`, **`unfilled_not_pulled: 23`**, decided 5
(2 wins / 3 losses), win rate 40% (CI 11.8–76.9%, genuinely low-n). This confirms the exclusion
population is real and non-trivial today, not just a 2026-07-14 artifact — roughly a quarter of all
non-open resolved rows are excluded as unfilled.

**A more important correction, from reading `debrief.ts`'s failure-mode classifier itself
(`debriefPlay`, precedence list at line ~487):** its PRIMARY per-play tag is gated on the
already-**persisted** `row.outcome` — step 2 of the precedence is literally `outcome unfilled →
band_detached | unfilled_never_traded_back`. `computeFill`'s own `filled`/`detail` fields are used
only for descriptive nuance WITHIN that branch (distinguishing "near-miss" from "structurally
detached" via distance-from-gate-threshold, and for MFE/MAE excursion narrative) — **never to
re-decide or override whether the row counts as a win, loss, or unfilled.** Every aggregate stat in
`debrief_report` (`failure_modes`, `improvement_queue`, etc.) and the whole `record` win-rate
computation defer to `resolveOutcome`'s stored `outcome` as the single source of truth.

**What this changes:** the original finding's severity (P2) assumed two competing graders could
produce two different live answers about the SAME play. They can't, today — `computeFill` never gets
a chance to override `resolveOutcome`'s persisted verdict anywhere in the product. The AMD 2026-07-07
row itself proves this precisely: its stored `outcome` is `"stop"` (graded before/under different
logic), so `debriefPlay` classifies it via the `outcome === "stop"` branch, matching the real record —
`computeFill.filled === true` on that row is consistent color, not a contradiction anyone sees.
**The live risk is narrower than originally scored: it is entirely about what `resolveOutcome`
produces for a FUTURE full-band-gap-through row (excluding it from win/loss), not about `debrief.ts`
silently disagreeing with a live stat anywhere today.** Downgrading blast-radius language
accordingly; the underlying product question (is blanket "unfilled" exclusion, including gap-through
LOSSES, the right rule) is unchanged and still needs the same decision — this only narrows WHERE the
consequence of that decision is felt (future grading only, not a live cross-module inconsistency).

Live population for the recommended follow-up measurement (replay each of the 23 currently
`unfilled_not_pulled` rows through `computeFill` and split win/loss-shaped vs. genuinely never-close):
`debrief_report.summary.failure_modes` (different window/report, so not a direct subtraction) shows
`unfilled_never_traded_back: 16` of 141 debriefed rows — still requires a per-row replay to answer
the loss-exclusion question precisely; the admin analytics/debrief-aggregate routes only expose
aggregates, not a raw per-play list, so this remains a follow-up needing a small dedicated script
(same shape as this toolkit's other `*-ab.mjs` measurement tools), not something answerable from the
existing endpoints alone. No gate/grading logic changed by this update — still OPEN/HOLD.
