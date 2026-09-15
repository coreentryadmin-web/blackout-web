> **kind:** FINDING

## `breakTrigger`'s "Break watch" bullet never considers the GEX king strike, so a live winner's own headline risk line can cite a level 8x farther than the real nearest structural risk — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `breakTrigger` (`src/lib/swing/play-brief-narrative.ts`) and `buildStructureLadder`'s
`riskTheOtherSide` (`play-brief-ladder.ts`) both read the same nearest-sorted `focal` array from
`collectFocalLevels` — but `breakTrigger`'s support/resist predicates only recognized
`kind === "put_wall" || kind === "dark_pool"` (support) and `kind === "call_wall"` (resist).
`kind === "king"` (the GEX king strike — the single largest gamma concentration on the board, and
narrated two lines earlier in the same brief as a level where "moves can accelerate through if wall
fades") was never a candidate, even though it sits in the same array `.find()` already iterates.

**Evidence (live reproduction, 2026-09-15, forensic batch 30):**
- **CRWD** (positionId 19, LONG, +149.8% live P&L): `structureLadder.riskTheOtherSide` correctly
  named the GEX king at **$230.00 (-2.41%)** as the real nearest structural risk. The SAME
  response's "Break watch" bullet said "lose **$190.00**" (put wall, -19.4%) — 8x farther away.
  The brief's own two risk-level widgets disagreed with each other inside one payload.
- **RBLU** (Banger breakout candidate): riskTheOtherSide named the king at **$6.00 (-4.3%)**;
  Break watch said "lose **$2.00**" (put wall, -68.1%) — operationally meaningless as a stop
  reference for a 3-DTE option.
- Same shape confirmed on ABTC, APPX, CGEM, CRWL, DRIP (support side) and GOOG (resist side:
  riskTheOtherSide named the king at +1.77%, Break watch said "reclaim $360.00").

**Why it matters:** "Break watch" is the one sentence in the brief that answers "at what price do
I actually need to act?" On CRWD, the brief was telling the trader they had 19.4% of room before
the desk says exit-or-cut-size, when the platform's own more-detailed ladder computation says the
real structural risk was only 2.4% away — an understated proximity-to-risk read on real, currently
open capital, not a cosmetic inconsistency.

**Blast radius:** `breakTrigger` has three call sites in `play-brief-narrative.ts` — the "Break
watch" bullet in `tradeManagerNarrativeSection`, the standalone real break-level export used by
`play-brief.ts`'s `envelope.invalidation` field, and the WATCH-lane variant — all three share the
one fixed function.

**Fix:** added `l.kind === "king"` to both the `support` and `resist` predicates. `focal` is
already sorted by unsigned distance from spot, so `.find()` now correctly returns whichever real
wall — including the king — is nearest, with no other logic change needed.

**Fix rationale:** minimal, single-condition addition to each predicate; no change to
`collectFocalLevels`, the sort order, or any other narrative section. Considered making
`breakTrigger` delegate to `riskTheOtherSide`'s own selection directly so the two can never drift
apart again, but that is a larger refactor than this fix needs — left as a follow-up idea, not
implemented here, to keep this PR a single scoped correctness fix.

**Test:** RED→GREEN proven — two new regression tests (LONG support-side and SHORT resist-side)
built directly off the live CRWD/GOOG repro shapes, both confirmed failing (citing the farther
put/call wall instead of the nearer king) against pre-fix code, passing after. Full
`play-brief-narrative.test.ts` (78 tests) and `src/lib/swing/*.test.ts` (1144 tests) green, `tsc
--noEmit` clean.
