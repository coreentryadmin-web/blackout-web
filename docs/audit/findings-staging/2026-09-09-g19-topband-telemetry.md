# G-19 top-band inversion: hard block removed, kept as telemetry

> **kind:** FINDING

## Root cause / decision

G-19 hard-blocked FLOW-origin score>=85 setups unless Vector confirmed a winner/runner
alignment, based on F-5 evidence (85+ measured 33% WR vs 63.6% at 75-84). Operator-approved
CTO gate-architecture review (2026-09-09) removed this as a hard block — score>=85 FLOW-origin
now proceeds normally through the rest of the stack.

## Fix

The determination itself (would this candidate have been in the population the old hard gate
blocked?) remains useful signal, so it now surfaces as a new non-blocking
`ZeroDteGateVerdict.topBandInversionFlag: boolean` field — true precisely for score>=85,
FLOW-origin, NOT Vector-winner/runner-aligned (the exact population the removed hard gate
used to target). Never gates a commit.

## Blast radius

- `ZeroDteGateVerdict` gained `topBandInversionFlag` (always computed by
  `evaluateZeroDteGates`; the `refresh*` helper functions spread `...gate` so it survives
  their partial re-evaluations unchanged).
- `board.ts`'s `score_top_band` `ZeroDteGateFailure` code is retained as a historical/type
  value only — its doc comment now says it is never pushed by `evaluateZeroDteGates` anymore.
- `scan.ts`: `gate_calibration_json` now also carries `top_band_inversion_flag` alongside the
  existing G-4/G-6 calibration columns, so the persisted ledger row is queryable for a
  recurrence of the F-5 inversion pattern without re-deriving it from raw score/origin.
- `gates.test.ts`: 4 existing tests rewritten from asserting a block to asserting COMMIT +
  the correct `topBandInversionFlag` value, plus a new CONDOR test (flag always false,
  mirrors the live gate's own `!isCondor` scoping).
- `gates-replay-2026-07-13.test.ts`: the 7/13 replay's SPY expected-block-list dropped
  `score_top_band` (SPY still blocks on `tape_alignment` + `opening_window` regardless).

## Evidence

Full `src/lib/zerodte/*.test.ts` suite: 1305 pass / 0 fail on Node 20 (1 pre-existing
unrelated skip). Before the fix, the rewritten `gates.test.ts` tests and the 7/13 replay test
both failed (RED) asserting the old hard-block codes; after, GREEN. `npx tsc --noEmit` clean.

| **Status** | FIXED in `fix/g19-topband-telemetry` |
