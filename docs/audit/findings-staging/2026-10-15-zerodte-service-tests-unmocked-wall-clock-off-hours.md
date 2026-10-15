## `zerodte-service.test.ts`/`zerodte-board-convergence.test.ts` silently depend on the REAL wall clock via an unmocked `isEtExtendedWarmHours()` — fail whenever run outside 4am-8pm ET — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**Root cause.** Both files mock `../../features/nighthawk/lib/session` (`todayEt`/`etNowParts`/
`isTradingDayEt`/`nextTradingDayEt`) to simulate a fixed "11:30 ET, a trading day" and call that
hermetic — but `getZeroDteBoardPayload()`'s off-hours branch (`zerodte-service.ts` ~L1088) calls a
DIFFERENT function, `isEtExtendedWarmHours()` (`src/lib/et-market-hours.ts`), with **no `now`
argument**, so it defaults to the REAL `new Date()` and is never touched by the session mock. That
function's own 4:00 AM-8:00 PM ET window check (`mins >= etClock(4,0) && mins <= etClock(20,0)`)
therefore evaluates against whatever the ACTUAL wall-clock time is when the test happens to run,
not the simulated 11:30 ET the rest of the file assumes.

When real time falls outside that window (confirmed live, 2026-10-14 ~20:15-20:25 ET —
`isEtExtendedWarmHours()` called with no args returned `false`), `getZeroDteBoardPayload()` takes
the off-hours branch and serves the module-scope `lastGoodBoardLocal` instead of cold-building:
- In `zerodte-board-convergence.test.ts`'s "liveness: ... ADVANCES across cycles" test, the FIRST
  call within the test populates `lastGoodBoardLocal`; the SECOND call (after
  `sharedState.store.clear()` simulates the shared snapshot expiring) should trigger a fresh
  cold-build (`scanCalls` 1→2) but instead re-serves the first call's remembered board
  (`scanCalls` stays 1) — `assert.equal(sharedState.scanCalls, 2, ...)` fails (`1 !== 2`).
- In `zerodte-service.test.ts`, whose own header claims "Always-miss shared cache so
  getZeroDteBoardPayload cold-builds on EVERY call ... each case must see its own
  freshly-mutated `state`, never a snapshot published by a prior case" — the same off-hours branch
  breaks that exact guarantee: `lastGoodBoardLocal` is a module-scope variable this file never
  resets between test cases (no `beforeEach`, unlike the convergence test), so once ANY earlier
  test populates it, every later off-hours call silently serves THAT stale board instead of the
  current test's own `state`-driven one — producing a wrong `NVDA` status (`'HOLD'` instead of
  `'OPEN'`, read from an unrelated earlier test's ledger row), a `TypeError: Cannot read properties
  of undefined (reading 'status')` (a stale board missing a field the current assertion expects),
  and two further mismatches on tier passthrough.

**Evidence.** Reproduced deterministically on 4 separate commits (`origin/main` @
`c1f36491b53bd96ea30f482a21e37801e2a09153`, and 3 commits further back including `c59d04851`, the
earliest of tonight's unrelated fixes) — proving this is NOT a regression from any recent PR, only
a function of what real time it happens to be when the suite runs: `5 fail` identically on every
commit tested, `0 fail` the instant `isEtExtendedWarmHours()` is mocked true regardless of commit.
Direct check: `node --import tsx -e "import('./src/lib/et-market-hours.ts').then(m =>
console.log(m.isEtExtendedWarmHours()))"` at 2026-10-14 20:24 ET printed `false`. Git-stash
RED→GREEN: without the fix, both files together report `30 pass / 5 fail`; with the fix,
`35 pass / 0 fail` (confirmed by stashing just the two test-file edits and re-running, then
popping). `tsc --noEmit`: clean. Full `src/lib/platform/*.test.ts`: `65 pass / 0 fail`. Full `npm
test`: clean (see PR for the exact run).

This means the suite has been able to fail in CI itself (not just this sandbox) any time a CI run
happened to execute between 8:00 PM and 4:00 AM ET — a latent, date/time-independent (reproduces on
every commit) but wall-clock-dependent flake that nobody had previously traced to its actual cause.

**Blast radius.** Exactly the two test files (`zerodte-board-convergence.test.ts`,
`zerodte-service.test.ts`) — both import `getZeroDteBoardPayload`/`zeroDtePlaysForLargo` from
`zerodte-service.ts`, the only two files mocking its dependencies for hermetic testing. No
application code is at fault: `getZeroDteBoardPayload()`'s off-hours "serve last-good local board"
branch is intentional, documented production behavior (avoids an expensive cold rebuild on every
off-hours poll) — the bug is purely in the TEST's incomplete hermeticity, not in what ships.

**Fix rationale.** Added `mock.module("../et-market-hours", { namedExports: { isEtExtendedWarmHours:
() => true, isEtCashRth: () => true } })` to both files, placed next to the existing session mock
they already use for the same purpose. `isEtCashRth` is included (not just the one function
actually needed) because replacing a module's named exports via `mock.module` drops every export
NOT listed to `undefined` for every consumer of that module during the mock's lifetime —
`live-marks.ts`'s background mark-refresh (reached via async activity these files' real board
builds kick off) calls `isEtCashRth()` directly and would otherwise throw `TypeError: ... is not a
function` after the triggering test had already ended (observed when the fix initially mocked only
`isEtExtendedWarmHours` — all 11 foreground subtests in the convergence file passed, but the file
still reported `not ok` from an uncaught async exception). `tickerShard` (the module's third
export) is not used anywhere in this call chain (confirmed via grep) so it did not need mocking.

Considered injecting `now` through the call chain (`getZeroDteBoardPayload()` → `isEtExtendedWarmHours(fixedNow)`)
instead — rejected as a larger, riskier change to production code for a problem that is purely
about test hermeticity; mocking the dependency at the test boundary is the same pattern these files
already use for every other time-of-day function.
