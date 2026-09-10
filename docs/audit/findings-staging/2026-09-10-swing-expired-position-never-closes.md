> **kind:** FINDING

## Swing positions past contract expiry never closed — a stale latched mark deferred the grade forever — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Swings — live position lifecycle / exit-management (`swing-active-refresh` cron, `roll-plan.ts`) |
| **Severity** | P1 — real committed positions permanently stuck OPEN/HOLD/TRIM instead of closing, corrupting the shared live-marks pool and (until fixed) permanently unable to ever resolve |
| **Found by** | Cross-lane collaboration — the 0DTE/Night-Hawk-owner lane's `zerodte-e2e-healthcheck.mjs` Stage D run (2026-09-10) found the symptom and reported it on the standing collaboration thread ([PR #4076](https://github.com/coreentryadmin-web/blackout-web/pull/4076#issuecomment-5624538329)); this lane (Swing) traced the root cause and shipped the fix, since `swing_positions`/`live-marks-active.ts`/`roll-plan.ts` are Swing-owned. |

### What was broken

28 real `swing_positions` rows were stuck at `status IN ('OPEN','HOLD','TRIM')` with option contract expiries **6–27 days in the past** (e.g. `O:SPCX260814C00120000`, expiry 2026-08-14, found 2026-09-10). Because `fetchOpenSwingPositions()` (`status NOT IN ('CLOSED','ROLLED')`) feeds the shared live-marks pool (`live-marks-active.ts` → `mergeSwingActivePlays`, `ZERODTE_LIVE_CONTRACT_CAP = 100` slots shared with 0DTE), these 28 permanently-dead rows occupied **~28% of the shared live-quote capacity** both engines' members compete for, and produced a permanent false RED on the 0DTE lane's own `zerodte-e2e-healthcheck.mjs` Stage D (LIVE MARKS+P&L).

### Root cause

`buildSwingRollPlan` (`src/lib/swing/roll-plan.ts`) is the ONLY code path that can transition a `swing_positions` row to a terminal `CLOSED`/`ROLLED` status — it does so by freezing the parent's realized P&L from a mark (`resolveParentGradeMark` → `gradeParentFromMark`), then `closeAndRollSwingPosition` performs the write. `resolveParentGradeMark` deliberately refuses to freeze a fabricated grade: it uses this tick's live option mark if present, otherwise the ledger's latched `last_mark` — **but only if that latch is younger than `MAX_LATCHED_MARK_AGE_MS` (90 minutes)**. Past that bound it returns `null`, and the caller correctly DEFERS rather than trust stale evidence — exactly the right call for a position that's still trading.

The gap: **an expired option contract can never again produce a fresher quote.** Once a position's contract crosses its expiry date without having been closed, `reads.mark` is permanently `null` (no live options market exists post-expiry) and the latched `last_mark`'s age only ever grows. The 90-minute trust window — sized correctly for a live, actively-quoted position — becomes an unconditional, permanent block once the contract expires: `resolveParentGradeMark` returns `null` on literally every subsequent cron tick, forever, so `evaluateSwingManagement`'s `expiry_risk` gating rung (specifically designed to force an EXIT before this exact scenario) can fire correctly every single cycle and still never actually close the position, because the write path it depends on can never produce a grade to freeze.

This was confirmed against the live-reported symptom, not assumed: live Polygon `/v2/last/trade` checks against a sample of the flagged tickers (ETH, GBTC, ETHU, MSTX, BLSH, FIGR, CRCA, CRCG, SPCH, SPCX, OKTA) all returned healthy, current underlying spot data — ruling out a data-provider gap for the underlying stock as the cause, and confirming the failure is specifically in the OPTION mark / grade-freeze path once the contract itself expires.

### Fix

Added a narrow, explicit escape hatch to `resolveParentGradeMark`: when the latched mark is past the staleness bound **and** the position's DTE (`reads.dte`, already computed every cron tick — no new date math) is negative (contract definitively expired), the stale latched mark is used anyway, tagged with a new, distinct `ParentMarkSource` value (`"latched_last_mark_expired"`) so `grade_json.mark_source`/`basis` stay honest about which trust path produced the freeze — a reader can always tell this apart from a normal in-window latch.

This is **not** a weakening of the "never freeze a fabricated grade" guarantee: the mark used is still a REAL price this contract actually traded at (the last one ever observed), never invented. The fix only recognizes that for an expired contract, "wait for a fresher quote" is a promise that can never be kept — so the fail-closed behavior that's correct for a live position becomes fail-*forever* for an expired one, and needs its own termination condition.

```ts
if (ageMs > MAX_LATCHED_MARK_AGE_MS) {
  const contractExpired = isFin(dte) && dte < 0;
  if (!contractExpired) return null; // too stale to trust — defer, do not freeze
  return { mark: latched, source: { source: "latched_last_mark_expired", observedAt: row.last_mark_at, ageMs } };
}
```

The call site (`buildSwingRollPlan`) now threads `reads.dte` through — the same DTE `active-refresh`'s per-row loop already computes for every position every cycle, so this adds no new I/O or date computation.

### Evidence

Four new tests in `src/lib/swing/roll-plan.test.ts`:
- `resolveParentGradeMark: a STALE latched mark is used anyway once the contract has expired (dte < 0) — never defers forever` — confirms the escape hatch fires ONLY when `dte < 0` (not for `dte === 0` or `dte === 5`, ruling out an accidental blanket widening of the staleness bound), and that a fresh latch with `dte < 0` still takes the ordinary path unchanged.
- `gradeParentFromMark: an expired-latch source grades with the same honest 'latched' basis as a normal latch` — confirms `grade_json.basis`/`mark_source` correctly reflect the new source.
- `buildSwingRollPlan: a CLOSE-gated position with an expired contract + stale latch now closes instead of deferring forever` — an end-to-end integration test reproducing the exact live bug shape (27-day-stale latch, `dte: -27`, an `expiry_risk` CLOSE verdict) and proving it now closes; the SAME test also proves (via an `undefined`-dte call) that omitting the fix's input reproduces the original stuck-forever defer, confirming this test would have failed RED before the fix.

Confirmed RED→GREEN by `git stash`-ing the `roll-plan.ts` change and re-running: 2 of the 4 new tests fail without the fix (the `dte < 0` escape-hatch assertion and the end-to-end CLOSE integration test), 0 fail with it.

Full `src/lib/swing/*.test.ts` (919 tests) + `npx tsc --noEmit`: clean.

### Blast radius

Single function (`resolveParentGradeMark`) and its one call site (`buildSwingRollPlan`). `gradeParentFromMark`'s basis-selection logic (`markSource.source === "live_quote" ? ... : "latched_last_mark_vs_entry_premium"`) already needed no change — it was written as a boolean check against `"live_quote"` rather than an exhaustive switch, so the new source value falls into the correct "latched" basis automatically. No other caller of `resolveParentGradeMark` exists. The banger-lane / 0DTE marks pool this bug was polluting is read-only from Swing's perspective (the 28 rows will drop out of `fetchOpenSwingPositions()`'s result on their next successful refresh cycle once this deploys — no backfill/migration needed, the existing cron naturally re-evaluates every OPEN row every ~15 minutes).

### Why this and not something bigger

Considered whether to also handle the case where a position has `last_mark === null` (never once successfully marked, not just stale) — decided NOT to in this PR: that is a genuinely different, harder problem (there is no real observed price at all to freeze, so any grade would have to be inferred — e.g. from intrinsic value at expiry vs. the underlying spot — which is a design decision, not a mechanical fix, and risks fabricating a number the "never freeze a fabricated grade" principle exists specifically to prevent). Every position that was ever live for any length of time before expiring will have picked up at least one successful `last_mark`/`last_mark_at` stamp from `updateSwingLiveState` on some earlier refresh tick, so this fix is expected to resolve the reported 28 rows; the "never marked at all" edge case is flagged as a follow-up, not silently left unhandled — if a genuinely zero-mark stuck row is found live, it needs its own separate design pass, not a rushed extension of this one.
