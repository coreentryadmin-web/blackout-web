> **kind:** FINDING

## `play.trough` was rendered once as a bare number but never interpreted anywhere in the narrative — FIXED (enhancement)

| **Status** | FIXED (this commit) |
|---|---|

**What was missing:** `play.trough` (the position's own worst intra-trade excursion) is computed
symmetrically alongside `play.peak` on every `TerminalPlay` row and rendered once in the Position
section (`play-brief.ts`) — but nothing in the trade-manager narrative ever interpreted it. A
position that swung from a deep drawdown to a strong peak is real, conviction-relevant volatility a
trade manager would cite ("this one tested you early, don't flinch on the next drawdown scare" /
"this name doesn't sit still, bank into strength") — exactly the kind of engineering investment the
sibling "Round-tripped past breakeven" giveback coaching (`mfeCaptureOutcome`, peak-vs-current)
already got, but trough-vs-peak never received the same treatment.

**Evidence (live, forensic batch 33, dedicated narrative-quality pass, 2026-09-15):** CG round-
tripped from -34.6% to +221.2%; CRWD (the board's #1-ranked, largest open winner) from -57.2% to
+161.3% peak. Neither brief said anything about the drawdown that preceded the win.

**What changed:** a new coaching function, `troughResilienceCoaching`, wired into
`collectCoachingBullets` — fires only on a real, meaningful swing (peak-minus-trough ≥ 40 points
AND the position actually traded negative at some point), OPEN bucket only (a CLOSED play's own
"Lessons" section already covers post-mortem framing for that bucket, so this doesn't duplicate
it).

**Fix rationale:** minimal, additive — a new, narrowly-gated coaching function using fields already
computed and already rendered elsewhere (`play.trough`/`play.peak`); no existing section, gate, or
recommendation logic touched. The 40-point / must-have-traded-negative gate is deliberately
conservative so it only fires for genuinely notable volatility, not every position with a nonzero
trough.

**Test:** RED→GREEN proven (git-stashed the source change, confirmed 6 new regression tests — the
positive case built off the live CRWD shape, a shallow-swing silence case, a never-went-negative
silence case, a missing-data silence case, and a bucket-gating case — all fail on import when the
export doesn't exist, all pass after restoring the fix). Full
`play-brief-narrative-coaching.test.ts` (99 tests, +6) and `src/lib/swing/*.test.ts` (1158 tests)
green, `tsc --noEmit` clean.
