## formatOverlapPosition's cross-engine label for a duplicate OTHER ticker answered a question about the wrong ticker's engine — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate static-code sweep (Workflow correctness audit of
`play-brief.ts`/`play-brief-narrative.ts`/`play-brief-intel.ts`).

**Root cause:** `formatOverlapPosition(p, reviewedTicker, dupTickers, reviewedIsBangerOrigin)` has
two distinct reasons to disambiguate a position: (a) `p.ticker === reviewedTicker` (the reviewed
play's own ticker showing up again via a cross-engine sibling), and (b) `isDuplicateOtherTicker` —
some OTHER ticker (not the one being reviewed) appearing twice in the same overlap list (the
2026-09-20 fix, live repro RIOT's brief showing MSTX twice). For case (a), checking
`reviewedIsBangerOrigin` (computed once from the REVIEWED play) is sound — the comparison is
literally "is this sibling's engine different from the reviewed play's own engine" for the SAME
ticker. But for case (b), the two duplicate rows belong to some OTHER ticker entirely — whether
those two rows are cross-engine to EACH OTHER has nothing to do with whether the reviewed ticker
happens to be Banger-origin. The code applied the same `reviewedIsBangerOrigin` check to both cases,
so for the duplicate-other-ticker branch it answered a question about the wrong ticker's engine.

**Live impact:** RIOT reviewed as a swing-native play (`reviewedIsBangerOrigin = false`), with the
open book independently holding TWO Banger-origin positions on MSTX (both `positionId == null`,
distinct `bangerId`s) landing in RIOT's same-theme overlap list — both MSTX rows rendered as
"(separate, cross-engine position #N)", falsely implying two independent engines both like MSTX
when in fact it is the exact "same engine, same ticker, twice" case the 2026-10-20 same-ticker fix
was written specifically to stop mislabeling. The inverse failure is equally reachable: if the
reviewed play were ITSELF Banger-origin while the duplicate MSTX rows were genuinely mixed-origin
(one swing-native, one Banger), the Banger row would be mislabeled as merely "(separate position
#bangerId)" with the real cross-engine distinction silently dropped.

**Fix:** Added `tickersWithMixedOriginDuplicates` — computes, per rendered list (scoped the same way
`tickersAppearingMoreThanOnce`'s `dupTickers` already is), which tickers' duplicate groups mix a
native swing row (`positionId` set) with a Banger-origin row (`positionId` null). `formatOverlapPosition`
now uses this set for the `isDuplicateOtherTicker` branch's cross-engine determination, while the
`isReviewedTicker` branch keeps using `reviewedIsBangerOrigin` (still the right question for that
case).

**Fix rationale:** Additive — a new, correctly-scoped signal for the one branch that needed a
different question answered; the `isReviewedTicker` branch and its existing `reviewedIsBangerOrigin`
logic are untouched.

**Blast radius:** `formatOverlapPosition`'s signature gained one parameter; both call sites in
`bookContextSection` (same-direction and opposed-direction blocks) updated to compute and pass it.

**Tests:** 2 new regression tests — (1) two Banger-origin duplicate-OTHER-ticker rows are labeled
same-engine ("separate position #N"), not falsely cross-engine, regardless of the reviewed play's
own origin; (2) a genuinely mixed-origin duplicate-OTHER-ticker pair stays correctly labeled
cross-engine even when the reviewed play is itself Banger-origin. RED→GREEN proven via `git stash`
on just the source file (both new tests failed pre-fix — rendered the wrong label — pass post-fix).
Full `play-brief-intel.test.ts` (288 tests) green on Node 20. `tsc --noEmit` clean.
