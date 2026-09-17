> **kind:** FINDING

## Session governor counted an open iron condor's nominal fade side as real directional exposure — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | 0DTE deep-dive (architecture trace of every directional-vote aggregation in the engine) |
| **Severity** | P1 (live production risk-gating: could either wrongly BLOCK a genuinely uncorrelated directional commit, or under-report real concentration risk — a financial-consequence bug in the session governor, not just a display/narrative one) |
| **Files** | `src/lib/zerodte/governor.ts` (`GovernorOpenPlan`, `evaluateZeroDteGovernor`, `concentrationReasonForCandidate`, `freezeConcentrationState`, `deriveGovernorFromLedger`), `src/lib/zerodte/gates.ts` (`refreshGovernorCycleBlocks` + both `evaluateZeroDteGovernor` call sites), `src/lib/zerodte/scan.ts` (four `GovernorOpenPlan`-shaped construction sites) |
| **Found by** | Architectural trace of the governor's directional concentration/conflict checks, per the task's explicit prompt to check whether the governor's directional concentration logic excludes condors the way its P&L-sign handling already does |

### Root cause

`governor.ts` already special-cases committed CONDOR rows in three places — `ledgerRowStopped`
(a condor's trough is the *winning* direction, so directional stop math inverts),
`ledgerRowRealizedPnlPct` (seller-framed P&L sign), and `riskContribution`
(condor risk = `max_loss`, not `entry_premium`) — proving the module's author was actively
reasoning about the condor's structural difference. One more place was missed: the two
DIRECTIONAL governor checks, **B-3 correlated-conflict** and **Q9 same-direction concentration**.

Both checks compare `direction` fields across `GovernorOpenPlan` entries built from
`deriveGovernorFromLedger`'s `openPlans.push({ ticker, direction: r.direction })` — unconditionally,
with no condor exclusion. A condor's `direction` is only the pin's nominal fade side
(`condor.ts`'s `buildCondorSetup`: *"UNUSED by the neutral structure's gates/grader"*), never a
real directional stance. `CORRELATION_GROUPS`'s broad index/ETF group explicitly includes both
`SPX`/`NDX` (the two condor-eligible cash-settled roots) alongside `SPY`/`QQQ`/`IWM`/`DIA` — so a
real, live scenario is directly affected: an open SPX or NDX condor whose nominal fade side happens
to be, say, "short" could (a) get flagged as **"opposing"** a genuine, uncorrelated SPY/QQQ/IWM/DIA
long candidate and wrongly BLOCK it (`correlated_conflict`), and (b) inflate the same-direction
concentration count (`governor_concentration`, Q9) with a structure that carries no real
directional risk to concentrate. The same false-directional-stance shape also let a *fresh CONDOR
candidate itself* be wrongly blocked as "opposing" a real open directional play with no actual
conflict.

`freezeConcentrationState` (the frozen `entry_context.concentration` evidence pinned at every
commit, used by the calibration loop to ask "how concentrated was the book when this played
committed?") had the identical gap — its `gross_directional_count`/`same_direction_open_count`
fields would silently include condors, corrupting the very evidence a future calibration pass would
read as "directional."

### Evidence

RED before the fix (`git stash` proof of `governor.ts`+`gates.ts`+`scan.ts`, Node 20,
`--experimental-test-module-mocks`, `governor.test.ts`): 4 failures —
- an open SPX condor (nominal `direction: "short"`) wrongly produced a `correlated_conflict` block
  against a genuine, uncorrelated QQQ long candidate;
- two open condors (SPX/NDX, nominal `long`) alongside one real SPY long wrongly tripped the Q9
  concentration cap on a 3rd real correlated long candidate;
- a fresh CONDOR *candidate* itself was wrongly blocked as opposing a real open SPY long;
- a pre-existing `summarizeGovernorForBoard` deep-equal assertion needed updating to include the
  new (correct) `is_condor: false` field on a real directional open plan.

GREEN after: 58/58 pass in `governor.test.ts`; `npx tsc --noEmit` clean; full `npm test` on Node 20
green (see PR).

### Blast radius

Every construction site of a `GovernorOpenPlan`-shaped object needed the new `is_condor` field
stamped so the exclusion is real everywhere, not just at one call site:
`deriveGovernorFromLedger` (ledger-derived open plans), `scan.ts`'s `governorAccurate` (thesis-first
reconcile lane), `committedThisCycle` (the ordinary fresh-commit lane), and `acceptedThisTxn` (the
atomic transactional recount lane) — plus both `evaluateZeroDteGovernor` call sites in `gates.ts`
(the live gate pass and the thesis-first `refreshGovernorCycleBlocks` re-apply pass) needed
`is_condor` threaded onto the *candidate* side too, so a fresh condor candidate skips the two
directional checks entirely rather than only being protected once already committed.

### Fix rationale

Added `is_condor?: boolean` to `GovernorOpenPlan` (and to `evaluateZeroDteGovernor`'s candidate
shape), computed once via a new shared `isCondorLedgerRow` helper (replacing three previously
duplicated inline `ec?.play_type === "CONDOR" || Boolean(ec?.condor)` checks with one). Both
directional checks now operate on a `directionalExposure` list with condor entries filtered out,
and are skipped entirely when the candidate itself is a condor. **Left deliberately unchanged**:
the plain concurrency cap (`governor_max_concurrent`) and every other non-directional governor
check (session-stop halt, realized-loss halt, premium budget, gamma budget) — a condor is still
real open risk/bandwidth, just not *directional* risk, so it correctly still counts toward those.
This is a strict correctness fix, not a loosening: every existing REAL directional conflict/
concentration test in the suite still fires exactly as before (verified in the regression tests
added alongside the condor-specific ones).
