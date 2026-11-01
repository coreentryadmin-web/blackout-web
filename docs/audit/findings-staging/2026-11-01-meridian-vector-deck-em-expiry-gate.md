> **kind:** FINDING

# Meridian earnings `vector.bands`/`vector.move_pct` fallback reintroduced the PDD/XPEV/SMTC dead-expiry defect

| | |
|---|---|
| **Area** | Meridian earnings event detail — `src/lib/meridian/meridian-earnings-intel.ts` (Vector desk pillar) |
| **Severity** | P2 — member-visible, financially-misleading but not crash/outage |
| **Status** | Fixed |

## Root cause

`meridian-em-scope.ts`'s own header documents a live-measured defect (2026-08-21, PDD/XPEV/SMTC):
a Vector "weekly horizon" expected-move quote (`getVectorExpectedMove(ticker, "weekly")`) is
scoped to the weekly series' FRONT expiry, which after that expiry's own close is a dead series —
and the function still returns a `movePct`/`bands` pair off it, just one up to ~90x too small,
because `remainingYearsToExpiry` floors a dead expiry at one minute of life instead of returning
null. `expiryCoversPrint()` was built specifically to withhold a quote whose expiry doesn't cover
the earnings print date, and `loadMeridianEarningsIntel`'s `vector_move_pct` headline field is
correctly gated by it (`vectorCoversPrint`).

Two sibling paths computing the SAME `vector.move_pct`/`vector.bands` panel fields were not:

1. **`bands` had no gate at all.** The shipped code read `vectorEm?.bands?.map(...)` directly —
   not through `vector_move_pct` — so on a non-covering quote, `move_pct` was correctly nulled
   while `bands` kept rendering the exact same stale, order-of-magnitude-wrong cone. A
   self-contradicting payload: a panel with no headline number but a (wrong) band chart under it.
2. **The `fetchVectorFullState` fallback had no gate on EITHER field.** `vectorFullState.expectedMove`
   is a SECOND, independent call to the identical `getVectorExpectedMove(ticker, "weekly")`
   function (confirmed in `vector-full-state.ts:197`, which also notes in its own comment that the
   object carries a real runtime `.expiry` field despite the narrower declared `ExpectedMove`
   type). Running the same risky call through a different wrapper doesn't remove the risk — the
   fallback could resolve a different front expiry at a different instant and reintroduce the
   identical dead-expiry quote whenever `vectorEm` itself was null/unavailable (or, for `bands`,
   whenever `vectorEm` existed but didn't cover the print, since the old `bands` chain fell
   through from the ungated `vectorEm?.bands` straight to this equally-ungated fallback).

## Evidence

- `src/lib/meridian/meridian-em-scope.ts`'s own header is the primary evidence: live prod capture
  2026-08-21 21:50Z showing PDD, XPEV, SMTC all serving a dead-expiry Vector quote under the
  `chain_iv`/weekly-cone label, with the mechanism (`earningsEm ?? vectorEm.movePct*100 ?? ...`)
  spelled out and the ~90x error measured directly (BEKE: 1.2% → 0.9% → 0.3% decaying through the
  session as the front expiry died).
- That exact mechanism was fixed for `expected_move_pct`/`vector_move_pct` (gated by
  `vectorCoversPrint`) but, read against the live code, never reached `bands` or the
  `fetchVectorFullState` fallback for either field — confirmed by direct code read of
  `loadMeridianEarningsIntel`'s `vector:` field construction (the `shapeMeridianVectorDeskRead({...
  move_pct: ..., bands: ...})` call).
- RED→GREEN: added 4 regression tests for the new `resolveVectorDeskMove` pure function in
  `meridian-earnings-intel-core.test.ts`. Reverting just the production fix (keeping the new
  tests) reproduces a RED state (4/27 failing — `resolveVectorDeskMove is not a function`, since
  the function and its gate didn't exist); restoring the fix brings the suite back to 27/27 green.
  Also ran the full existing `meridian-em-scope.test.ts` / `meridian-vector-for-earnings-core.test.ts`
  / `meridian-thermal-scope.test.ts` / `meridian-ladder-inversion.test.ts` suites (31/31 pass) and
  `tsc --noEmit` clean.

## Blast radius

Only one render path consumes these two fields today: `MeridianEarningsIntel.vector.move_pct` /
`.bands`, shaped by `shapeMeridianVectorDeskRead` and rendered by the Meridian earnings event
detail's Vector desk pillar (bands feed the expected-move cone chart next to the headline number).
No other caller of `loadMeridianEarningsIntel` or `shapeMeridianVectorDeskRead` was found reading
these fields through a different path. `resolveIntelExpectedMove`'s existing `expected_move_pct`/
`expected_move_source` gate (the fix this mirrors) was already correct and is untouched.

## Fix rationale

Added `resolveVectorDeskMove` (pure, in `meridian-earnings-intel-core.ts`, same place
`resolveIntelExpectedMove` already lives for exactly this testability reason — the orchestrator
file is `server-only` with dynamic `@/` imports and can't be exercised directly in a test). It:

- Returns the primary (`vectorEm`-sourced) `move_pct`/`bands` pair ONLY when `vectorCoversPrint`
  is true — matching the existing headline-field rule exactly, and now applying it to `bands` too
  so the two fields can never disagree about whether there's a usable quote.
- Otherwise checks the FALLBACK'S OWN expiry (not `vectorEm`'s — they're independent fetches that
  can resolve different front expiries) via the same `expiryCoversPrint` rule before using it.
- Withholds both fields together (`null`/`null`) when neither source covers the print — never a
  half-populated panel.

Deliberately left unchanged: `vector_move_pct`/`vector_expiry` as passed to
`buildMeridianEarningsReport` (lines earlier in the same function) — that path was already
correctly gated and has its own "only renders when `vector_move_pct != null`" suppression
documented in-code; this fix only touches the two fields that were missing the gate.
