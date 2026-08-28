> **kind:** FINDING

## `vol_rail_weak` and `failed_break_reversal_floor` were dead code — the rail's own internal floor already exceeded the threshold — FIXED

| **Status** | Fixed in PR (fix/dead-archetype-gate-thresholds) |
|---|---|

**Symptom:** While fixing the `momentum_rs_floor` tautology (see the 2026-08-28
momentum-rs-floor-tautology finding), audited every other rail-threshold check in
`archetype-gates.ts` for the same failure class and found two more — the mirror-image bug.

**Root cause:** Each rail scorer only returns a hit once its internal score clears its own
floor:
- `scoreReversalRail` (`rails/reversal.ts`) starts at base 42, returns `null` below 58.
- `scoreVolRail` (`rails/vol.ts`) starts at base 45, returns `null` below 52.

`FAILED_BREAKOUT`'s `failed_break_reversal_floor` checked `REVERSAL < 55` — always false, since a
fired REVERSAL score is never below 58. `VOL_EXPANSION`'s `vol_rail_weak` checked `VOL < 50` —
always false, since a fired VOL score is never below 52. Both checks were dead code: they could
never block/note anything the rail's own construction didn't already guarantee.

Unlike `momentum_rs_floor` (which always fired, unconditionally blocking an entire archetype),
these are the opposite failure mode — checks that never fire, providing no real protection while
implying they do. Lower severity (no plays were being wrongly blocked), but worth removing so the
code doesn't claim a check it never runs.

**Fix:** Removed both. `FAILED_BREAKOUT` keeps its `failed_break_still_triggered` watch note.
`VOL_EXPANSION` keeps its `vol_expansion_no_compression` watch note.

**Blast radius:** `src/lib/zerodte/thesis/archetype-gates.ts` only. New test file
`src/lib/zerodte/thesis/archetype-gates.test.ts` (created in the momentum-rs-floor-tautology PR;
this PR is based on `main` before that one merges, so it creates the same file — will need a
rebase/merge reconciliation, not a functional conflict, since the two PRs touch different
`switch` cases in the same file).

**Evidence of correctness:** `src/lib/zerodte/thesis/*.test.ts` + `src/lib/zerodte/*.test.ts`:
1231/1231 pass (1 pre-existing skip). `npx tsc --noEmit` clean. Node 20.
