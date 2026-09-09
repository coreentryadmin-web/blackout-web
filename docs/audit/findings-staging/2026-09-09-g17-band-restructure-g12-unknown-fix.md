# G-17 score-band restructuring + G-12 UNKNOWN-confluence fix

> **kind:** FINDING

## Decision (operator-approved CTO gate-architecture review, 2026-09-09)

The flat G-17 rule ("the 65-74 band needs score >= 75, regardless of rail corroboration")
conflated two different questions: the 2026-08-28 measurement showed an UNCONFIRMED 65-74
setup is weak EV (multi-rail/FLOW in that band ran 35.7% WR, worse than single-rail at 75+) —
it never showed that a genuinely well-CONFIRMED 70-74 setup is equally weak. Replaced with a
three-band architecture:

- **< 65**: REJECT — G-3's own floor, untouched.
- **65-69**: REJECT unconditionally — no admission path (still `single_rail_corroboration`,
  since no evidence supports admitting this lower sub-band under any condition).
- **70-74**: CONDITIONAL — eligible only if ALL of: confluence confirmations >= 2 (this
  band's OWN bar, via `g12ConfirmationCount`, regardless of time-of-day — separate from
  G-12's own floor elsewhere, which can be as low as 1), tape alignment satisfied where
  applicable, VIX-regime requirements met (the canonicalized G-4 uniform floor), and every
  other execution/safety gate (G-8/G-9 plan quality, G-21 contract liquidity) clean. A new
  distinct code, `conditional_band_unmet`, fires if any leg fails.
- **75+**: PRIME, unrestricted — unchanged.

**G-12 fix** (bundled, since it only matters for this new band): the 70-74 band's own >=2
confirmation bar is asking "is this confirmed enough to admit at a sub-prime score" — a
different question from G-12's own ordinary floor, which fails OPEN on a missing read
(never manufactures a block from an unmeasured factor). Here, a null confluence read is
treated as 0 confirmations for THIS check only — absence of measurement cannot answer "yes,
confirmed". G-12's own fail-open behavior everywhere else in this file is unchanged.

## Implementation note

The 70-74 conditional-band check runs at the VERY END of `evaluateZeroDteGates`, after every
other gate (G-1 tape, G-4 VIX, G-8/G-9/G-21 execution) has already evaluated and populated
`blocks` — it is the only gate in the stack whose own eligibility is defined in terms of
every OTHER gate's outcome rather than an independent read of its own. "Clean tape"/"clean
VIX"/"clean execution" are checked by absence of the relevant codes already in `blocks`
(`EXECUTION_SAFETY_GATE_CODES` names the execution/safety set explicitly, as a single place
to extend when a future gate like G-23 is added).

## Blast radius

- `gates.ts`: removed the old flat G-17 block + its Vector-exemption predicate call (the
  `vectorExemptsG17PrimeBand` import is now unused and removed); the 65-69 reject stays at
  the original call site; the new 70-74 conditional check is appended at function end.
- `board.ts`: new `conditional_band_unmet` `ZeroDteGateFailure` code.
- `gates.test.ts`: the literal deterministic test matrix from the review's own spec (score
  64/67/72-in-various-conditions/78/87), plus the pre-existing G-17 tests (which happen to
  land in the 65-69 sub-band and so still assert the same `single_rail_corroboration` code
  unchanged).
- `gates-replay-2026-07-13.test.ts`: MU (score 73, in the new 70-74 sub-band) now reports
  `conditional_band_unmet` instead of the old flat `single_rail_corroboration`.

Built stacked on top of #4636 (item 6, G-18) and #4638 (item 7, G-19) since this band's
"clean VIX"/"clean tape" checks and the score-87 test both depend on the canonicalized G-4
(item 1) and the G-19 telemetry downgrade (item 7) already being in place — merged locally
into this branch for a working composition, per the cross-PR ordering-dependency discipline.

## Evidence

Full `src/lib/zerodte/*.test.ts` suite: 1323 pass / 0 fail on Node 20 (1 pre-existing
unrelated skip). Before the fix, the 7/13 replay's MU expectation failed (RED,
`conditional_band_unmet` vs the old `single_rail_corroboration`) until updated (GREEN).
`npx tsc --noEmit` clean.

| **Status** | FIXED in `fix/g17-band-restructure-g12-unknown` |
