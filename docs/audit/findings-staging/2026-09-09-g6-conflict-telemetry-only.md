# G-6 cross-system conflict downgraded from hard gate to informational telemetry

> **kind:** FINDING

## Root cause

`CONFLICT_SCORE_FLOOR` (55) sits strictly **below** `ZERODTE_SCORE_FLOOR` (65, G-3's own hard
floor). Every gate in `evaluateZeroDteGates` evaluates independently and the overall verdict is
`BLOCKED` if ANY gate fails — so a conflicted setup can only ever have G-6 be the deciding factor
for a score in `[55, 65)`, and a score in that range already fails G-3 regardless of G-6. G-6 has
been **structurally unable to change any outcome** since the 2026-09-08 loosening pass dropped its
floor below G-3's: it never independently blocks anything G-3 doesn't already block, and never
independently admits anything G-3 already blocks. A hard gate that cannot change the verdict is
dead code with a plausible-looking reason string attached.

## Fix

`evaluateZeroDteGates` no longer pushes a `cross_system_conflict` block. The conflict
determination itself is real and useful cross-desk-disagreement information (a 0DTE entry
opposing a live SPX Slayer play or a recent Night Hawk take on a correlated ticker), so it now
surfaces as a new non-blocking `ZeroDteGateVerdict.crossSystemConflict: { conflict: boolean;
against: Array<"spx_slayer"|"nighthawk_edition"> } | null` field — visible for telemetry, never
gates a commit. `null` when inapplicable (a CONDOR is delta-neutral, mirrors the calibration
record's existing `applicable: false`).

`computeGateCalibration`'s `g6_conflict` record is UNCHANGED — it still measures what the old hard
gate WOULD have done (would_block at score < 55), preserved as ongoing evidence in case a future
gate redesign wants that history.

## Blast radius

- `ZeroDteGateVerdict` type gained the new `crossSystemConflict` field (always populated by
  `evaluateZeroDteGates`; the four `refresh*` helper functions in the same file spread `...gate`
  so it survives their partial re-evaluations unchanged).
- Checked `gateRejectionFor`/rejections.ts/db.ts for dangling references to the
  `cross_system_conflict` gate-failed code: none found outside `gates.ts`'s own type union and
  `pane.ts`'s display-label map (`cross_system_conflict: "G-6 · cross-system conflict"`), both of
  which remain valid since the code stays a legitimate historical/type value — it simply never
  gets pushed as a live block anymore.
- `gates.test.ts`: 6 tests rewritten from asserting a hard block to asserting the new telemetry
  field (conflict still flagged, never blocks, at any score including well below the old 55
  floor), plus a new CONDOR-inapplicable (`null`) test and a no-conflict-clears-clean test.

## Evidence

Full `src/lib/zerodte/*.test.ts` suite: 1305 pass / 0 fail on Node 20 (1 pre-existing skip,
unrelated). `npx tsc --noEmit` clean. Before the fix, the rewritten tests failed (RED) asserting
the old hard-block codes never surfaced; after, they pass (GREEN) asserting the new telemetry
field while confirming zero blocking behavior at any score.

| **Status** | FIXED in `fix/g6-conflict-telemetry-only` |
