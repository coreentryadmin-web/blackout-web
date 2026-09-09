# G-18 early-window prime score: Vector exemption removed

> **kind:** FINDING

## Root cause

G-18 (the early-window `[10:00, 10:45)` ET prime-score floor — E2 evidence: sub-75 scores in
this window cluster on full-stop losers) borrowed its exemption predicate VERBATIM from
G-17's own Vector-alignment exemption (`vector_g17_exempt === true || vectorExemptsG17PrimeBand(...)`).
That borrowed exemption was never itself measured against E2's specific evidence — E2 is a
TIMING effect (the worst-timed 45 minutes of the session), and Vector alignment agreeing with
the setup's direction says nothing about whether the timing risk is mitigated. Vector could
exempt a sub-prime score from the early-window floor with no evidence that doing so is safe.

## Fix

Operator-approved CTO gate-architecture review (2026-09-09): remove the Vector-exemption
branch from G-18's block condition specifically — it becomes an unconditional `score < 75`
block inside `[10:00, 10:45)` ET, no exceptions.

**G-17's OWN Vector exemption is completely untouched** — it is a separate code path (the
`single_rail_corroboration` block, further down in `evaluateZeroDteGates`), and both G-17 and
G-19 still reference `vectorExemptsG17PrimeBand`/their own exemption predicates. This PR
changes precisely one gate's use of that shared helper, not the helper or G-17/G-19 themselves.

## Blast radius

Single call site — G-18's block condition in `evaluateZeroDteGates` (gates.ts). No other
consumer references G-18's verdict independently.

## Evidence

`gates.test.ts`: no existing test exercised the Vector exemption specifically for G-18 (the
two pre-existing G-18 tests don't pass `vector_g17_exempt`/`vector_pulse`, so they were
unaffected). Added a new test proving `vector_g17_exempt: true` no longer clears the
`early_window_prime_score` block at a sub-75 score inside the early window. Full
`src/lib/zerodte/*.test.ts` suite: 1304 pass / 0 fail on Node 20 (1 pre-existing unrelated
skip). `npx tsc --noEmit` clean.

| **Status** | FIXED in `fix/g18-remove-vector-exemption` |
