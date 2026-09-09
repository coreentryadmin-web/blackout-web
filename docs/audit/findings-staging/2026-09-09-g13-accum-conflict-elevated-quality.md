# G-13 flow-accumulation conflict: hard block → elevated quality requirement

> **kind:** FINDING

## Root cause

`ZERODTE_BLOCK_ACCUM_MISALIGN` (default true) hard-blocked ANY setup where
`flowAccumulationAligned === false` — the multi-day options flow accumulation opposes the
setup's own direction. This was an unconditional veto: even a strong, well-confirmed setup
(high score, multiple independent confluence confirmations) could never override a stacked-
positioning disagreement, no matter how much OTHER evidence supported the trade.

## Fix

Operator-approved CTO gate-architecture review (2026-09-09): instead of an unconditional
block, a conflicted setup may now proceed if it clears an ELEVATED quality bar — score >= 75
(the same PRIME band G-17/G-18 already use elsewhere in this stack) AND confluence
confirmations >= 2 (reusing `g12ConfirmationCount`, the exact G-12 leg count — not a new
metric). `ZERODTE_BLOCK_ACCUM_MISALIGN` remains the on/off flag for the WHOLE mechanism
(both the check and the elevated-quality override it now gates).

A missing confluence read (`input.confluence == null`) cannot itself satisfy the >=2
confirmation requirement and still blocks even at a very high score — this is an ELEVATED
bar being asked to override a REAL, measured conflict signal, not G-12's own ordinary
fail-open (which never manufactures a block from an unmeasured factor elsewhere in this
file). Absence of measurement here is not evidence of agreement, so it stays conservative.

## Blast radius

Single call site in `evaluateZeroDteGates` (gates.ts) — no other consumer computes G-13's
verdict independently. The block `reason` string now also reports the actual score/confluence
count that failed to clear the bar, so a SKIP card explains WHY the elevated quality wasn't
met, not just that a conflict exists.

## Evidence

`gates.test.ts`: rewrote the "blocks when aligned === false" test (the default fixture's
score 80 + confluence(2) now CLEARS the elevated bar, so the old unconditional-block
assertion no longer held — RED until the score was lowered to demonstrate the still-blocking
case). Added 3 new tests: blocks on low score alone, blocks on sub-2 confluence alone at a
high score, clears exactly at the 75/2 boundary, and blocks regardless of score when
confluence is entirely absent. Full `src/lib/zerodte/*.test.ts` suite: 1306 pass / 0 fail on
Node 20 (1 pre-existing unrelated skip). `npx tsc --noEmit` clean.

| **Status** | FIXED in `fix/g13-accum-conflict-elevated-quality` |
