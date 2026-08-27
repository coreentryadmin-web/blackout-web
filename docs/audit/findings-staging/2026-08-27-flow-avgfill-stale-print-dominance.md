> **kind:** FINDING

## 2026-08-27 — [FINDING, P1 Night Hawk] `top_strike_avg_fill` had no recency weighting — a single hours-stale print could dominate the flow's reported average fill — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P1 — root cause of the entry-premium mispricing PR #2986 papered over downstream |

**Symptom.** PR #2986 (merged earlier today) fixed the *consequence* of this bug — a
symmetric ceiling on `resolveLedgerEntryPremium` so an outlier flow fill can no longer drag
the ledger's tracked entry basis far from the live mark — but explicitly left the *cause*
as a documented follow-up:

> Deliberately NOT attempted here: root-causing *why* `top_strike_avg_fill` was wrong for
> these two specific rows (a wrong-strike/expiry match inside the UW flow aggregation
> pipeline is the leading hypothesis, ...)

This finding traces that cause. The two live rows from 2026-08-27:

- `QQQ 720C 0DTE` — `top_strike_avg_fill` $3.27; the exact contract (`O:QQQ260827C00720000`)
  traded $0.84–$0.94 the entire 14:00–14:29 UTC window and never once reached $3.27 all
  session (session max $1.31 at 17:10 UTC).
- `NVDA 225C 1DTE` — `top_strike_avg_fill` $5.86; the exact contract traded ~$2.6–$3.1
  through the same window.

**Root cause.** `deriveZeroDteSetups` (`src/lib/zerodte/board.ts`) accumulates every UW
flow print at a given `(strike, expiry, side)` key over the ENTIRE query lookback (the
live board's FLOW query is `since_hours: 7`), and computes `avgFill` as a straight
premium-weighted average across the whole window:

```ts
const avgFill = top.fillW > 0 ? Math.round((top.fillPrem / top.fillW) * 100) / 100 : null;
```

There is no time weighting at all. A single early-session print with a large dollar
premium — a real UW-reported fill, not a wrong-strike match — permanently anchors the
average toward whatever price the contract traded at HOURS ago, even after the contract
has since decayed (or rallied) far away from that level and dozens of smaller, more recent
prints have come in at the current price. The bigger that one stale print's dollar
premium, the more it dominates: a $2M print at $3.27 outweighs two $100k prints at $0.90
by 10:1 in the weighted average, producing exactly the QQQ shape above (avg pulled to
~$3.05 versus a true current price of ~$0.90).

This is NOT a wrong-strike/expiry match (the leading hypothesis PR #2986 recorded) — the
aggregation key (`${strike}|${expiry}|${isCall}`) is built from typed numbers/strings with
no formatting ambiguity, and `fill_price` is UW's own reported per-print price for that
exact alert (`raw_payload->>'price'`, cast once in `fetchRecentFlows`, `src/lib/db.ts`).
The data is correct; the AGGREGATION has no concept of "how stale is this fill."

**Evidence.** Traced the exact call chain: `board.ts`'s per-print loop
(`cur.fillPrem += r.fill_price * prem; cur.fillW += prem;`) accumulates unconditionally
across the whole `rows` array passed in by `scan.ts` (`fetchRecentFlows({ since_hours: 7,
..., max_dte: 1 })`), with the resulting `avgFill` used directly as `top_strike_avg_fill`
on the emitted setup. No existing test exercised a strike with prints spanning more than a
few minutes apart, so this shape was untested. Reproduced with a synthetic tape (one $2M
print at $3.27 seven-plus hours stale, two $100k prints at $0.90 in the last few minutes)
— pre-fix this computed avgFill ≈ $3.05 (dominated by the stale print); the fix computes
$0.90 (the two recent prints only).

**Blast radius.** `top_strike_avg_fill` feeds `flow_avg_fill` throughout the pipeline
(`scan.ts` → `resolveLedgerEntryPremium` in `plan.ts`), which in turn drives:
- The ledger's own tracked/graded `entry_premium` (bounded by the #2986 ceiling, but a
  correct avgFill means the ceiling should now fire far less often — this is a real fix,
  not redundant with #2986).
- The **member-facing** `entry_max`/`stop_premium`/`target_premium` printed as the "enter
  at or below" instruction (`plan.ts` `buildContractPlan`) — #2986's ceiling deliberately
  does NOT touch this member-facing basis, so a stale-print-skewed avgFill was reaching
  members directly until this fix.
- `vs_flow_pct` and the Largo "premium already ran past the flow's fill" MOVED reasoning
  (`intel.ts`), which compares the live mark against this same average.

**Fix.** Added a per-strike, per-print timestamp record (`fillEntries`) alongside the
existing running `fillPrem`/`fillW` sums, and compute `avgFill` preferring only prints
within the SAME recency window (`SPIKE_WINDOW_MS`, 30 minutes) the sudden-flow-spike read
already uses just above it in the same function — reusing an already-calibrated constant
rather than inventing a new one. Falls back to the full-window average when nothing at
that strike is recent (a genuinely quiet/aged strike is unaffected, never goes null).

**Fix rationale.** Recency-windowing the average (not changing which STRIKE wins "top",
which is a separate, correctly-conviction-weighted decision) is the minimal change that
fixes the actual defect: "what did the flow pay" should mean "recently," not "ever in the
last several hours." Deliberately left unchanged: the `top` strike selection itself
(`premAggr`-ranked, unaffected by this fix), and PR #2986's ceiling (kept as a second,
independent line of defense — this fix reduces how often it needs to fire, it doesn't
replace it).

**Regression guard.** `src/lib/zerodte/board.test.ts`: 2 new tests — the QQQ-shaped stale-
dominant-print case (asserts the fixed $0.90, not the old ~$3.05), and a fallback case
confirming a strike with NO recent prints still returns the full-window average rather
than null. 127/127 pass in `board.test.ts`; full `zerodte` suite (1065/1071, the remaining
6 files require `--experimental-test-module-mocks` per `CLAUDE.md` and are unrelated to
this change) passes with that flag (96/96 across the affected files).
