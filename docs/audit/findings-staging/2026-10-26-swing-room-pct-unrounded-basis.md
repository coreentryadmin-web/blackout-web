> **kind:** FINDING

## Swing Largo play-brief room%/cushion% computed from unrounded mark basis, disagreeing with the displayed rounded dollar figures — FIXED

| **Status** | Fixed |
|---|---|

**Where:** `src/lib/swing/play-brief-narrative-coaching.ts` (`distanceSuffix`, the "next trim ...
bid/mark $X, needs $Y (+Z% from here)" bullet in Trade manager read) and
`src/lib/swing/play-brief-intel.ts` (`targetRoomPct` — "Premium target rail" room%, and
`cushionPct` — "Premium stop rail" cushion%, both in "What to watch").

**Root cause:** all three percentage computations divide by the raw, unrounded `mark`/`execMark`
float (`distanceBasis`/`targetBasis`/`cushionBasis`), while the SAME basis is displayed to the
member rounded to 2dp via `fmtOptionUsd`/`fmtUsd` (`Math.round(n * 100) / 100`, same rounding the
Position section's own "Mark: $X.XX" line uses). For a normal-priced contract the rounding error
is negligible and invisible. For a cheap sub-$0.10 contract — routine for Banger/breakout swing
plays, which trade weekly OTM calls/puts often priced in single-digit cents — the relative
rounding error is large and directly visible in the printed text.

**Live repro (WEN, `SWING:WEN:2098`, HOLD, 2026-10-26):** real contract `mid = 0.025`. The brief's
own Position section displays `Mark: **$0.03**` (correctly rounded). But "Trade manager read"
rendered `mark **$0.03**, needs **$0.12** (+380% from here)`, and "What to watch" rendered
`Premium target rail: **$0.12** — **380%** move still needed from current mark to reach target` —
both computed `(0.12 - 0.025) / 0.025 * 100 = 380%` from the raw float. A member doing the mental
subtraction on the two dollar figures literally printed, `(0.12 - 0.03) / 0.03`, gets **300%**, an
80-percentage-point gap on a trade-management number that directly informs position sizing and
risk/reward judgment. The stop-rail cushion% has the identical shape: a $0.025 mark against a
$0.02 stop reads `(0.025-0.02)/0.025*100 = 20%` raw vs the correct `(0.03-0.02)/0.03*100 = 33%`
once reconciled to the displayed basis.

**Blast radius:** exactly 3 call sites, all in the swing Largo play-brief narrative layer —
confirmed by grepping every `(X - basis) / basis) * 100` / `(basis - X) / basis) * 100` shape
across `src/lib`. `plan.ts` (0DTE) has two superficially similar `/ mark) * 100` expressions
(theta-decay-pct, spread-pct) but those are a different lane with different upstream rounding
guarantees — not touched, out of scope for this fix.

**Fix:** added `roundOptionUsd(n: number): number` to `src/lib/fmt-money.ts` — the numeric sibling
of `fmtOptionUsd`, same `Math.round(n * 100) / 100` algorithm, returned as a number instead of a
formatted string. Round the basis with it BEFORE the percentage math at all 3 sites, so the
percentage is always computed from the exact number the member sees printed beside it — the same
"reconcile to what's actually displayed" principle `round-floats.ts`'s `reconcileTrancheFractions`/
`reconcileStrikeTotal` already apply to sibling rounding-composition bugs in this codebase.

**Why this fix and not an alternative:** could instead have displayed MORE decimal precision for
sub-$0.10 contracts so the raw basis and the percentage stay mutually consistent at a finer grain
— rejected because every other dollar figure in the same brief (entry, stop, target, peak, trough)
is already fixed at 2dp via the shared `fmtOptionUsd`/`fmtUsd` formatters, and introducing a
different precision tier for one basis value would create a NEW inconsistency (why does this one
number have 3 decimals when everything else has 2) in place of the one it fixes. Rounding the
basis to match what's already displayed everywhere else in the brief is the minimal, consistent
fix.

**Test:** `play-brief-narrative-coaching.test.ts` ("'next trim' distance percentage is computed
from the rounded (displayed) mark, not the raw sub-cent float") and two new tests in
`play-brief-intel.test.ts` (target rail room% and stop rail cushion%), all reproducing the exact
WEN sub-cent shape. A pre-existing `play-brief-intel.test.ts` test ("Premium target rail still
shows the room% for a target no trim tranche has reached yet") asserted the OLD, raw-float 19% for
a `mark: 2.025` fixture; updated to the correct, rounded-basis 18% it now produces. Verified
RED→GREEN by stashing the source fix: the 3 new tests and the 1 updated test fail without it (4/533
in `play-brief-intel.test.ts` + `play-brief-narrative-coaching.test.ts`), pass with it restored.
Full `src/lib/swing/*.test.ts` + `fmt-money.test.ts` suite: 2112/2112 pass. `tsc --noEmit` clean.
