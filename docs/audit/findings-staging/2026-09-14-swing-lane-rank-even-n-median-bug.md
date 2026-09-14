> **kind:** FINDING

## Ask Largo's "Lane rank" median picked the lower of the two middle scores on an even-sized lane, not the statistical median — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `computeLaneRank` (`src/lib/swing/play-brief-lane-rank.ts:110`, pre-fix) computed the
lane's median score as `scores[Math.floor(scores.length / 2)]` against the peer set sorted
descending. For an **odd** peer count this is correct (the true middle element sits at that index
either way). For an **even** peer count, the statistical median is the *average* of the two middle
elements — but `Math.floor(n/2)` on a descending-sorted array indexes directly into the *lower* of
those two elements, never averaging. The bug systematically understates the median (and, since
`deltaFromMedian = playScore - medianScore`, correspondingly overstates every play's delta-from-
median) whenever a lane happens to have an even number of live rows — not an edge case: any lane
with an even peer count hits it on every request.

**Evidence (live reproduction, 2026-09-14, TSM):** TSM's live play-brief WATCH lane carried exactly
2 peers — TSM (59.2) and ORCL (51.8). Sorted descending: `[59.2, 51.8]`. `Math.floor(2/2) = 1` →
`scores[1] = 51.8`, the **lower** of the two scores. The brief rendered this verbatim as fact:

> Lane median: **51.8**
> (**+7.2** vs median)

The real median of a 2-element set `{59.2, 51.8}` is their average, **55.5** — the brief overstated
TSM's delta-from-median by 3.5 points (+7.2 shown vs the true +3.7) purely from the indexing bug,
with no data being wrong, only the arithmetic. The existing unit test suite only covered n=3 (odd),
where `floor(3/2)=1` happens to land on the correct middle element by coincidence — the even-n case
was untested and had never been caught, even though a 2-peer lane is a common, not rare, shape
(most WATCH-bucket lanes are small).

**Blast radius:** `computeLaneRank` is the single source for the "Lane rank" section on every swing
play-brief (`laneRankSection`, same file) — every play whose OPEN or WATCH lane happens to have an
even peer count at request time is affected; the median (and every downstream `deltaFromMedian`,
the rank-1/below-median narrative branches, and the `bias` field derived from it) all read off this
one value. No other call site independently recomputes a median.

**Fix:** replaced the single-index pick with a standard even/odd median: odd `n` still indexes the
middle element directly (`scores[floor(n/2)]`, unchanged behavior); even `n` now averages the two
middle elements (`(scores[n/2 - 1] + scores[n/2]) / 2`). Rounded to 1 decimal place with the same
`Math.round(x * 10) / 10` pattern the adjacent `deltaFromMedian` line already uses (documented in
that same function as guarding against an IEEE754 float-subtraction artifact) — averaging two floats
can produce the identical class of artifact, so the median needed the same guard once it could be a
non-integer average rather than always a single already-rounded score.

**Fix rationale:** kept the odd-`n` path byte-identical (it was already correct) rather than
unifying both branches into one generic formula, so the diff is minimal and the well-tested odd-`n`
behavior (7 existing tests exercise 3-peer lanes) is provably untouched. Considered but rejected:
leaving the bug and just re-labeling "median" as something else (e.g. "middle score") — rejected
because the field is genuinely meant to be a median (every narrative line built on it, e.g.
`deltaFromMedian`, assumes a real central-tendency comparison) and the fix is a one-line arithmetic
correction, not a mislabeled-but-intentional design choice like the regime/archetype finding earlier
today.

**Test:** RED→GREEN proven (git-stashed the source fix, confirmed the 2 new regression tests — a
live-shaped 2-peer TSM repro and a synthetic 4-peer case — both fail against the pre-fix code with
the exact wrong value `51.8` where `55.5` was expected, restored and confirmed all 21 tests in the
file pass green). Also updated 1 existing test (`deltaFromMedian is rounded...`) to use a 3-peer
(odd) lane instead of 2-peer, isolating the rounding behavior under test from the even-n averaging
behavior now covered separately — its own median value is now asserted explicitly (45.4) so a
future regression in either code path fails a distinct test. Full `src/lib/swing/*.test.ts` (1125
tests) green, `tsc --noEmit` and `eslint` clean on both changed files.
