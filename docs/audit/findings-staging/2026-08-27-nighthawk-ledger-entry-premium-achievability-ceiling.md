> **kind:** FINDING

## 2026-08-27 — [FINDING, P1 Night Hawk] Ledger `entry_premium` had no ceiling against the live mark — an outlier flow fill manufactured fake instant stop-outs — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P1 — real financial-reporting defect: false losses counted toward the session governor's realized-loser halt and toward the strategy's own track record |

**Symptom.** Live analysis of 2026-08-27's session (11 committed 0DTE plays) found two rows
whose `plan_stop` exit fired essentially instantaneously after commit:

- `QQQ 720C 0DTE` — flagged 14:12:30.000Z, `plan_stop` exit stamped 14:12:30.357Z (**357ms
  later**), reported P&L **-77.06%** (entry_premium $3.27, mark $0.745 at the check).
- `NVDA 225C 1DTE` — flagged 14:03:36.000Z, `plan_stop` exit stamped 14:03:37.248Z
  (**1.2s later**), reported P&L **-52.9%** (entry_premium $5.86, mark $2.73/$2.76).

A real intraday decay of 50-77% cannot happen in under two seconds without a violent
underlying move. Cross-checked against real Polygon 1-minute bars for both the underlying
and the exact OCC contract:

- `QQQ` underlying was flat (717.83 → 718.19, **+0.05%**) at 14:12 UTC.
- `O:QQQ260827C00720000` traded **$0.84–$0.94** the entire 14:00-14:29 UTC window and never
  once reached $3.27 anywhere in the session (session max seen: $1.31 at 17:10 UTC).
- `O:NVDA260828C00225000` traded **~$2.6–$3.1** through the same window — nowhere near $5.86.

So `entry_premium` itself was wrong at commit, not the mark: the ledger recorded a "fill"
roughly 2-4x the real, contemporaneous market price of the exact contract it committed.

**Root cause.** `resolveLedgerEntryPremium` (`src/lib/zerodte/plan.ts`) resolves the
ledger's tracked/graded basis as `planEntryMax ?? flowAvgFill`, then had exactly one
correction: *if the live mark at flag time is HIGHER than that base, floor the basis up to
the mark* (`markAtFlag > base → use markAtFlag`) — added earlier to stop a play from being
graded off a stale-cheap flow fill nobody could still get. That guard only ever bounded the
basis **upward**. There was no symmetric bound in the other direction: if the flow's
reported average fill (`top_strike_avg_fill`, effectively "what the smart money paid") sits
**far above** the live mark — because the print was stale, or upstream flow-aggregation
matched the wrong strike/expiry to this ticker's row — the ledger adopted that inflated
number wholesale, with nothing to catch it. The very next scan tick's exit check then finds
the position instantly deep underwater against its own -50% hard stop, purely from the
mispriced entry.

**Evidence.** Live production board + record dump for 2026-08-27, cross-referenced against
Polygon minute-bar history for both underlyings and the exact OCC contracts (see above).
`exit_policy_at_commit` confirms both rows ran under `trim_scale` (not a ratchet artifact);
`committed_at_et` / `first_flagged_at` vs `entry_context.exit.at` gives the ~0.02–0.35s
gaps directly. This is a live, reproduced, dated instance — not a hypothetical.

**Blast radius.** `resolveLedgerEntryPremium`'s output (`entry_premium`) feeds: the ledger's
own live P&L display (`marks-math.ts` `pinnedLivePnlPct`), the plan grader
(`gradePlanFromBars`), the governor's realized-loser count and premium-at-risk budget
(`governor.ts`), and every downstream calibration/feature-store consumer that reads
`plan_outcome`/`plan_pnl_pct`. A fake instant stop counts as a real loss everywhere in the
system — it is exactly the kind of mistaken realized-loser that fed the session's loss-halt
counter (`GOVERNOR_ENFORCE_LOSS_HALT`) before that channel was disabled earlier today.

**Fix.** Symmetric completion of the existing floor: when the live mark sits far **below**
the resolved base — by the same magnitude (`CHASE_PCT`, currently 55%) this same file
already treats as "too extreme to trust" for the opposite (chasing a moved fill) direction
— cap the ledger basis **down** to the mark instead of trusting the outlier fill:

```ts
if (markAtFlag != null && markAtFlag > 0) {
  if (markAtFlag > base) return round2(markAtFlag);
  const pctBelow = ((base - markAtFlag) / base) * 100;
  if (pctBelow >= CHASE_PCT) return round2(markAtFlag);
}
return base;
```

**Fix rationale.** This reuses an already-calibrated constant (`CHASE_PCT`) rather than
inventing a new threshold, and only fires on genuine outliers — an ordinary "CHEAPER" print
(mark a few/some percent below the fill, real front-running, which this codebase explicitly
treats as a *good* thing) is far inside the band and is completely untouched, as the new
tests confirm. Deliberately left unchanged: the member-facing `entry_max`/`stop_premium`/
`target_premium` (the printed "enter at or below" instruction) — only the ledger's own
internal grading/tracking basis moves, exactly mirroring the existing floor's own stated
boundary. Deliberately NOT attempted here: root-causing *why* `top_strike_avg_fill` was
wrong for these two specific rows (a wrong-strike/expiry match inside the UW flow
aggregation pipeline is the leading hypothesis, but confirming it needs a deeper trace
through the flow-accumulation code than this fix's scope) — left as a follow-up; this fix
makes the *symptom* (a false graded loss) impossible regardless of the upstream cause.

**Regression guard.** `src/lib/zerodte/board.test.ts`: 8 new assertions reproducing the
QQQ/comparable-NVDA shapes (capped to mark), the existing ordinary-CHEAPER case (untouched),
the exact `CHASE_PCT` boundary (fires at `>=`, matching the existing `MOVED` boundary
convention) and just inside it (does not fire), non-positive marks (never drag the basis
down), and the no-mark-supplied legacy path (unaffected). 125/125 pass in
`board.test.ts`; `plan.test.ts`/`exit-sync.test.ts`/`exit-engine.test.ts`/`scan.test.ts`
(97 + 26 with `--experimental-test-module-mocks`) all still pass.
