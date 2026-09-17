> **kind:** FINDING

## An open 0DTE iron condor got a fabricated "Thesis Health" score on the live command-deck and in Largo — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | 0DTE deep-dive (architecture trace of every directional-vote aggregation in the engine) |
| **Severity** | P1 (member-facing on the LIVE production command-deck `ThesisHealthPanel`, not just a Largo tool — a delta-neutral credit structure was scored and displayed as if it had a directional thesis, health %, and pillar breakdown) |
| **Files** | `src/lib/zerodte/thesis-health.ts` (`computeThesisHealth`) |
| **Found by** | Tracing every consumer of a 0DTE setup's `direction` field for condor-safety, after confirming `attachContractPlans` already explicitly guards condor rows out of the single-leg contract-attach path (`scan.ts`'s own comment: *"forcing it through buildOcc/buildContractPlan would fabricate a one-legged plan"*) — the same discipline was missing here |

### Root cause

`computeThesisHealth` (`zerodte-service.ts` calls it unconditionally for every OPEN/HOLD/TRIM
ledger row, condor or not) scores five pillars — flow, tape (SPY bias alignment), VWAP, market
alignment, confluence — all keyed off `live.direction`. For a real directional play that IS the
play's actual stance. For a committed 0DTE iron condor, `direction` is only the pin's nominal fade
side (`condor.ts`'s `buildCondorSetup`: *"UNUSED by the neutral structure's gates/grader"*) — the
same fact already established and fixed twice elsewhere this session (the Largo cross-product
adapter and the session governor). `computeThesisHealth` had no guard at all: it happily scored a
condor's nominal side as if it were a real directional thesis, producing a fabricated "Thesis
Health" percentage, rung (INTACT/DEGRADED/BROKEN), and pillar breakdown for a delta-neutral,
credit-sold structure that has no directional thesis to be intact or broken.

This is the highest-visibility instance of the pattern found this session: unlike the Largo-only
adapters, this value is rendered directly on the member's **live command-deck**
(`ThesisHealthPanel`/`PlayTerminal`/`CommandDeck`/`ZeroDteCommandPanel`, via
`zerodte-sources.ts`'s `thesis_health` field) for a real, currently-open condor position, in
addition to reaching Largo through the same `zerodte-service.ts` payload.

### Evidence

RED before the fix (`git stash` proof, Node 20, `--experimental-test-module-mocks`,
`thesis-health.test.ts`): 1 failure — a condor-shaped `entry_context`
(`{ ...baseCtx, play_type: "CONDOR", condor: {...} }`) on an OPEN row returned a real computed
thesis-health object (non-null, with pillars) instead of the honest `null` this function already
returns for other "not applicable" cases (a non-working status, a missing `entry_context`).

GREEN after: 8/8 pass in `thesis-health.test.ts`; `npx tsc --noEmit` clean; full `npm test` on
Node 20 green (see PR).

### Fix rationale

Added one guard clause returning `null` for a condor row (`ec.play_type === "CONDOR" ||
Boolean(ec.condor)`, the same structural check used in `governor.ts`'s `isCondorLedgerRow`),
placed immediately alongside the function's two EXISTING "not applicable" `null` returns
(non-working status, missing `entry_context`) — `null` is already this function's established
contract for "no thesis health to show," and every consumer already handles it correctly:
`CommandDeck.tsx`, `PlayTerminal.tsx`, and `ZeroDteCommandPanel.tsx` all gate on
`thesisHealth != null` today (with existing tests asserting the section never renders when it's
absent — e.g. `ZeroDteCommandPanel.test.ts`'s *"never renders the Thesis integrity section when
thesisHealth is absent"*), and `PlayTerminal.tsx` already falls back to an "entry-quality score"
display for rows with no thesis health wired (the same path a WATCH/Legacy row already takes).
So this degrades safely with **zero new UI plumbing** — a condor's "Thesis integrity" section
simply stops rendering, which is the honest state (there is no thesis to measure), rather than
needing a bespoke condor-aware panel.

Considered and rejected as a first cut: building a condor-specific thesis-health variant (e.g.
scoring "is the range still intact" against the condor's own breach levels) — that is a genuine,
real enhancement idea (see the accompanying report), but it is new product surface, not a bug fix,
and is out of scope for this finding; `null` (an honest "not applicable," matching the codebase's
own established convention) is the correct and minimal fix for the immediate correctness defect.
