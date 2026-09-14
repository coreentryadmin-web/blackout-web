> **kind:** FINDING

## Ask Largo's "Manage plan" trim-ladder line restated the same trigger percentage twice for the common single-rung case — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `manageLifecycleCoaching` (`src/lib/swing/play-brief-narrative-coaching.ts`) appends
a parenthetical `(${ladder})` recap to the "next trim at" / "rail already cleared" clause
unconditionally — `ladder` being every `trim_levels` entry joined, regardless of how many there are.
For the common case (most swing plays carry exactly ONE trim trigger, `total === 1`), `ladder` is
just `+${next.trigger_pct}%` — byte-identical to the number the clause already states — so the
parenthetical adds nothing, it just restates the same figure twice.

**Evidence (live reproduction, 2026-09-14, forensic batch 10 — AMLX, NEO, HACK, MSTX, PZZA, all
single-rung ladders):** every one of the 5 briefs read

> **Manage plan** — next trim at **+100%** (+100%) · ...

with the identical `100` appearing twice, once as the stated trigger and once in the parenthetical
that exists specifically to show the *rest of the ladder* — which doesn't exist here. Found via
forensic batch 10 of the standing Night Hawk Swings audit mandate (CLAUDE.md).

**Blast radius:** `manageLifecycleCoaching` is the sole source of the "Manage plan" line — every
OPEN play with an unfired first trim and exactly one configured trim rung (the majority shape,
per the shipped `SWING_SCALE_OUT_POLICY` single-rung default) is affected, on both the "next trim
at" branch and the sibling "rail already cleared, not yet banked" branch (2026-09-14's earlier
CG fix). A genuine multi-rung ladder (`total > 1`) is unaffected — there the parenthetical shows a
real second rail not otherwise stated.

**Fix:** the parenthetical is now conditional on `total > 1` — omitted entirely for a single-rung
ladder (never replaced with a placeholder; the clause already states the one number that matters),
shown as before when a real second rail exists to recap.

**Fix rationale:** kept the multi-rung path byte-identical rather than reformatting the ladder
recap into a different shape, so the fix is a pure narrow of when the clause fires, not a rewrite of
what it says when it does. Considered dropping the parenthetical unconditionally instead — rejected
because a genuine multi-rung ladder needs it: without it, a member on a two-rung plan reading "next
trim at +50%" has no way to see the second, later rail (+100%) from this line alone.

**Test:** RED→GREEN proven (git-stashed the source fix, confirmed 2 new tests — one per branch —
fail against pre-fix code with the exact live-shaped duplicate output, restored and confirmed
green). Added a third test proving a real 2-rung ladder still shows its full recap, so the fix
provably narrows rather than removes the feature. Full `src/lib/swing/*.test.ts` (1130 tests)
green, `tsc --noEmit` and `eslint` clean on both changed files.
