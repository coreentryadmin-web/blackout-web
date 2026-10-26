> **kind:** `FINDING`

## 0DTE governor `ledgerRowStopped()` counted a genuinely profitable ratchet/thesis/flat exit as a hard STOP, feeding phantom stops into the G-5 session-stop halt — FIXED

| | |
|---|---|
| **Severity** | P2 (risk-control miscount — can trip a live-enforced trading halt on a winning session; no member-facing data corruption, and the separate realized-P&L channel this bug's sibling already fixed was unaffected) |
| **Surface** | `src/lib/zerodte/governor.ts` — `ledgerRowStopped()`, feeding `deriveGovernorFromLedger()`'s `stops` tally, consumed live by `evaluateZeroDteGovernor()`'s G-5 hard-halt (`GOVERNOR_MAX_SESSION_STOPS`) and surfaced on the board via `summarizeGovernorForBoard()` |
| **Status** | FIXED |

### Root cause

`ledgerRowStopped(r)` decided whether a closed ledger row was a hard STOP by checking the raw
mechanical `plan_outcome` column **first**:

```ts
function ledgerRowStopped(r: GovernorLedgerRow): boolean {
  if (isCondorLedgerRow(r)) return false;
  if (r.plan_outcome === "stopped") return true;   // <-- the bug
  if (r.status !== "CLOSED") return false;
  return (
    r.entry_premium != null && r.entry_premium > 0 &&
    r.trough_premium != null &&
    r.trough_premium <= r.entry_premium * (1 + PLAN_RULES.stop_pct / 100)
  );
}
```

`plan_outcome`/`plan_pnl_pct` are the **naive, mechanical bar-walk grade** — what an UNMANAGED
hold would have done, walking the contract's own minute bars all the way to the plan's fixed
−50/+100/15:50 rules regardless of what the live engine actually did. They are computed and
stamped independently of, and often *after*, a real live exit. When the exit engine closes a
position early for a genuine profit via a ratchet profit-floor, a thesis-break veto, or a
flat-theta-bleed exit (`entry_context.exit`, stamped by `exit-engine.ts`'s `buildExitContext`),
the mechanical bar-walk can still "trade" the same contract's bars onward from that point and
independently conclude the position would *later* have traded through the −50% hard stop —
producing `plan_outcome: "stopped"` / `plan_pnl_pct: -50` for a row that, as actually managed,
closed green.

Checking `plan_outcome === "stopped"` first therefore miscounted that real WIN as a STOP, and fed
it straight into `deriveGovernorFromLedger`'s `stops` array — the array `evaluateZeroDteGovernor`'s
G-5 hard-halt (`governor_session_stops`, `GOVERNOR_MAX_SESSION_STOPS = 4`) enforces **live**,
blocking every new commit for the rest of the session once 4 stops accumulate. A session with
several genuine ratchet/thesis/flat wins could accumulate 4 *phantom* stops this way and trip the
halt on what was actually a winning day — the exact failure mode G-5 exists to prevent, triggered
by the counting mechanism itself rather than by real losses.

### Precedent / why this was left open before

A sibling P&L channel in the same file, `ledgerRowRealizedPnlPct` (feeding
`session_pnl_pct`/`realized_losers`), had this exact mechanical-vs-as-managed precedence bug fixed
on 2026-10-20 (the HOOD finding — a real ratchet-floor exit at +3.35% was counted as a −50%
realized loser because `plan_pnl_pct` was read before the as-managed exit). That fix explicitly
left `ledgerRowStopped` out of scope at the time (see that function's own doc comment and
`governor.test.ts`'s SEV-3 test block). This finding closes that gap.

### Evidence

New tests in `src/lib/zerodte/governor.test.ts`:

- `"ledgerRowStopped: a genuine ratchet-exit WIN is never counted as a governor stop, even though
  the mechanical plan_outcome says 'stopped'"` — a row with `plan_outcome: "stopped"`,
  `plan_pnl_pct: -50`, trough dipped ~-8.5% off entry at some point, but
  `entry_context.exit = { reason: "ratchet_profit_floor", pnl_pct: 7.87, peak_pnl_pct: 20 }` (the
  bug's own motivating shape — ratchet exit at +7.87%, trough dipped -8.66% off entry at some
  point). Also asserts `evaluateZeroDteGovernor` returns no blocks for a fresh candidate, i.e. the
  live-enforced G-5 consumer is clean too.
- `"ledgerRowStopped: a genuine as-managed thesis/flat exit is also never counted as a stop..."` —
  same shape with `entry_context.exit.reason: "thesis_break_veto"` and a trough that would
  independently read as a hard stop under the OLD trough-latch fallback (1.9 on a 4.0 entry);
  confirms the fix isn't narrowly scoped to just the ratchet reason family.
- `"ledgerRowStopped: a genuine as-managed STOP still counts, matching scan.ts's own real-time
  check (exit reason 'plan_stop')"` — a row with `entry_context.exit.reason: "plan_stop"` (a REAL
  hard stop) still counts, proving the fix doesn't just stop counting stops altogether.
- `"ledgerRowStopped: a row with no live-managed exit at all still falls back to the mechanical
  plan_outcome/trough (legacy rows unaffected)"` — a row with no `entry_context.exit` at all still
  uses the original mechanical check, proving full backward compatibility for legacy/ungraded rows.

RED→GREEN confirmed via a manual pre-fix/post-fix swap (this sandbox's shared git-stash stack made
a bare `git stash` unsafe, so the pre-fix file content was restored from `git show HEAD:...`,
applied, tested, then the fixed content was restored):
- **Before the fix:** 65/67 tests pass, 2 fail — both new ratchet-exit and thesis-exit tests,
  each asserting `snap.stops` is empty but observing the ticker present (`AAPL`/`META`
  respectively) in the stop tally.
- **After the fix:** 67/67 pass.

All 67 tests in `governor.test.ts` pass post-fix, including every pre-existing test (the existing
`"deriveGovernorFromLedger: a stop is detected from the graded plan_outcome OR the latched trough"`
test and the trough-boundary tests, which carry no `entry_context` and therefore exercise the
unchanged mechanical/trough fallback path unaffected by this fix).

### Blast radius

`ledgerRowStopped` is a private function with exactly two consumers, both inside `governor.ts`:
`deriveGovernorFromLedger` (exported, used by `scan.ts` and `zerodte-service.ts`'s
`summarizeGovernorForBoard`) and nothing else repo-wide (verified by grep — no other file
references `ledgerRowStopped`, `summarizeGovernorForBoard`, or `deriveGovernorFromLedger` outside
`governor.ts`/`scan.ts`/`zerodte-service.ts` and their own test files). The fix changes what counts
as a stop more accurately in both consumers; neither assumed the old (incorrect) semantics as
correct, so no other call site needed a change.

One stale doc comment inside `evaluateZeroDteGovernor` (the UNTIMED STOP / fail-closed re-entry
lock section) described the old two-signal check (`plan_outcome === "stopped"` OR the latched
trough) — updated in the same PR to mention the as-managed signal, since it was describing
`ledgerRowStopped`'s behavior by name.

### Fix

`ledgerRowStopped` now checks the AS-MANAGED exit reason first: `readManagedExit(r.entry_context)`
(the same `entry_context.exit` blob `record.ts`'s as-managed P&L lane already reads) and, when a
real exit reason is present, `categorizeExitReason(reason)` (the existing single source of truth
for the reason→family vocabulary, also used by `record.ts`) decides — only the `"stop"` category
(`plan_stop`) counts as a real stop; `ratchet`/`thesis`/`flat`/`target` never do, no matter what the
mechanical `plan_outcome` column independently says. Only when there is **no** as-managed exit at
all (legacy rows, or a row the engine hasn't exited yet) does the function fall back to the
original mechanical `plan_outcome === "stopped"` / trough-latch check — byte-for-byte unchanged, so
a row with no live-managed exit stamp is graded exactly as it was before this fix.

### Fix rationale

Mirrors the exact real-time equivalent `scan.ts` already uses to decide a real stop-out for its own
Discord-notification/Redis-stop-recording purposes:
`(state.status === "CLOSED" && state.closed_reason === "stopped") ||
exit?.decision.reason === "plan_stop"` — i.e. the AS-MANAGED signal, never the mechanical column.
`governor.ts` has no access to that live `state`/`exit.decision` object (it only ever sees
persisted ledger rows), so the fix uses the row's persisted equivalent of the same signal
(`entry_context.exit.reason`, categorized) rather than inventing a new vocabulary.

Considered reusing `record.ts`'s full `managedGradeView`/`asManagedOutcome`-shaped precedence
(engine exit > genuine WS-11 trim-scale reconstruction > mechanical fallback) for symmetry with
`ledgerRowRealizedPnlPct`'s own `asManagedPnlPct` call — prototyped this as an `asManagedOutcome`
export and found it breaks backward compatibility for one class of existing test fixture: a graded
row whose `plan_outcome` is stamped but whose `plan_pnl_pct` is still null (a real, pre-existing
possible data shape — the lazy grader can stamp the outcome label before the pnl value) reads as
UNGRADED under `isGradedZeroDteRow`'s finite-pnl requirement, which would silently stop counting it
as a stop at all and fall through to the trough-latch fallback — changing behavior for rows this
fix never intended to touch. The simpler, narrower `readManagedExit` + `categorizeExitReason`
approach taken instead needs only the exit `reason` field (ignoring `pnl_pct`'s finiteness
entirely), so it reproduces the OLD mechanical/trough fallback behavior exactly for every row shape
that isn't carrying a real live-managed exit — deliberately narrower in scope than the P&L
channel's own fix, but correct for exactly the bug this finding is about.

### Tests

`src/lib/zerodte/governor.test.ts` (4 new tests, described under Evidence above). Full file: 67/67
pass. `npx tsc --noEmit` clean repo-wide. Sibling files that read/write the same ledger rows
(`record.test.ts` 173/173, `exit-engine.test.ts`, `exit-sync.test.ts`, `scan.test.ts` 46/46) all
still pass unaffected — `record.ts` itself carries no code change (an `asManagedOutcome` export was
prototyped and reverted per the Fix rationale above, so its diff is empty).
