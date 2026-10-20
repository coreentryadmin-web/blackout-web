## 2026-10-20 — [FINDING, P1 Night Hawk 0DTE] Governor SEV-3 loss-halt read the naive mechanical grade instead of the real as-managed outcome — FIXED

> **kind:** FINDING

**Context.** Standing Night Hawk 0DTE forensic-monitor sweep. After today's trim_scale
narrative fix (PR #6396) merged, the board's `governor` payload was checked as part of a
routine end-of-session review (this lane hadn't looked at the governor/condor surface at all
today). It reported `realized_losers: 19` and `session_pnl_pct: -68.91%` out of 30 closed
positions — directly contradicting the SAME board's own `live_pnl_pct` field, which showed 19
POSITIVE closes and only 9 negative. One of these two numbers had to be wrong.

**Root cause.** `governor.ts`'s `ledgerRowRealizedPnlPct` read `r.plan_pnl_pct` — the raw
`zerodte_setup_log.plan_pnl_pct` DB column — as its first-preference signal for "did this
position realize a win or a loss." Per `docs/audit/OUTCOME-GRADING-SPEC.md` (and `record.ts`'s
own `mechanicalGradeView`/`managedGradeView` split), that column is the **MECHANICAL** grade:
`gradePlanFromBars` walking the contract's MID price against the fixed −50%/+100%/15:30-ET plan
rules, from first flag to the END OF THE SESSION — a simulation of what a completely unmanaged,
passive hold would have done. It is **never** the real outcome once the live exit engine
actually closed the position earlier for a different reason (a ratchet profit floor, a
thesis-break veto, a flat-timeout scratch). `record.ts` encodes this precedence deliberately and
explicitly: its own doc says the mechanical grade is "NEVER the headline" — only a labeled,
side-by-side comparison. `governor.ts`'s inline comment, by contrast, called `plan_pnl_pct` "the
true close P&L" — a direct mischaracterization of the exact field record.ts goes out of its way
to avoid treating as authoritative.

**Live evidence.** HOOD (today, 2026-10-20): real `live_pnl_pct = +3.35%`, `closed_reason:
"ratchet"` — a genuine win, the position exited via the live ratchet-profit-floor mechanism.
Its `plan_pnl_pct` (mechanical) read **-50** with `plan_outcome: "stopped"` — because after the
real engine had already closed the position, the underlying later traded down far enough that a
naive, unmanaged hold (the mechanical simulation) would have hit the hard stop. Both numbers are
individually correct for what they measure; the bug is that the governor's SEV-3 loss-halt
diagnostic picked the wrong one. Six more rows today showed the same shape in magnitude (BMNR,
MUU, APLD, AAL, CRWV, CLSK, HIMS: all real wins or smaller real losses under `live_pnl_pct`,
all showing a materially worse mechanical `plan_pnl_pct`).

**Blast radius.** `realized_losers`, `session_pnl_pct`, and `would_halt` — all three fields
surfaced live on `GET /api/market/zerodte/board`'s `governor` payload, documented in the
function's own comment as "calibration evidence" for a human deciding whether to flip
`GOVERNOR_ENFORCE_LOSS_HALT` (currently off by default, so this did not actually block any
commit today — the board's `halted: true` came from the separate, unaffected 4-hard-stop
channel). But the diagnostic itself was badly wrong: it reported today as a losing session
(-68.91%, 19/30 "losers") when the real, as-managed outcome was a clearly profitable day (19
positive / 9 negative / 2 flat by `live_pnl_pct`). Anyone using this as calibration evidence —
exactly its stated purpose — would be working from a fabricated picture of risk.

**Fix.** `ledgerRowRealizedPnlPct` now calls `record.ts`'s `asManagedPnlPct` (the SAME precedence
`managedGradeView` already implements and the record route already headlines: a real engine exit
first, a genuine WS-11 trim-scale reconstruction second, the mechanical grade only as the final
fallback for a row with no live-managed exit at all) instead of reading `plan_pnl_pct` directly.
`asManagedPnlPct`'s signature was narrowed from `ZeroDteSetupLogRow` to the already-exported
`OfficialGradableRow` (just `plan_outcome`/`plan_pnl_pct`/`entry_context` — the only fields it
ever touches, via `managedGradeView`/`mechanicalGradeView`, also narrowed the same way) so
`governor.ts`'s own `GovernorLedgerRow` — which already carries `entry_context` — satisfies it
directly with no new field plumbing. The stop-trough fallback (`ledgerRowStopped`) and the
THIRD CHANNEL (mark-vs-entry estimate for a CLOSED-but-ungraded row, the original 2026-08-11
AUDIT SEV-3 fix) are both unchanged — this only replaces what counts as "graded."

**Fix rationale.** Considered reimplementing the as-managed precedence locally in governor.ts,
but that would create a second, driftable copy of logic record.ts already owns and tests
extensively (managedGradeView's WS-11 reconstruction precedence, `realExitIsBarWalkReproducible`,
etc.) — reusing `asManagedPnlPct` directly means governor.ts can never silently fall out of sync
with what the member-facing record route itself calls the real outcome.

**Tests.** 3 new cases in `governor.test.ts`: the HOOD-shaped real-win-vs-fictitious-mechanical-
loss case (RED before the fix — confirmed via `npx tsx --experimental-test-module-mocks --test`
— the old code read `-75` from the mark-fallback or `-50` from plan_pnl_pct, new code reads the
real `+3.35`), a genuine-loss case proving a real loss with a *different* mechanical magnitude
still counts correctly, and a legacy/no-live-exit case proving the mechanical fallback is
unchanged for rows with no as-managed stamp at all. One pre-existing test
("a graded row still wins — the mark channel never overrides plan_pnl_pct") had its fixture
corrected to pair `plan_outcome` with `plan_pnl_pct` (the real DB always writes both columns in
the same `UPDATE` — the fixture previously set only one, which happened to also expose the gap
between the old loose `r.plan_pnl_pct != null` check and the stricter, correct
`isGradedZeroDteRow` the fix now goes through). `governor.test.ts` 63/63, `record.test.ts` 41/41,
`scan.test.ts` 46/46 pass; `tsc --noEmit` clean (Node 20); full `npm test` run alongside this PR.

| **Status** | FIXED. `GOVERNOR_ENFORCE_LOSS_HALT` remains off by default (unchanged) — this fix corrects the diagnostic's VALUE, not whether it enforces anything. No gate/threshold/halt behavior changed for the one channel that IS always enforced (the 4-hard-stop count, `ledgerRowStopped` — untouched). |

Related: `docs/audit/OUTCOME-GRADING-SPEC.md` (the mechanical-vs-managed duality this bug
confused); PR #6396 (today's earlier, related trim_scale narrative fix — same root family of
"a live-only real outcome vs. a naive bar-walk simulation disagreeing," different surface).
