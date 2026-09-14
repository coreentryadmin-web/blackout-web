> **kind:** FINDING

## Night Hawk Legacy — average-return fields fabricate a 0% when there is nothing to average (held, broad blast radius)

| | |
|---|---|
| **Status** | OPEN — reported per the standing escalation policy (correct fix touches multiple member- and admin-facing consumer files; not a same-cycle mechanical change) |
| **Area** | Night Hawk Legacy — outcome/record analytics (`src/features/nighthawk/lib/analytics.ts`), consumed by the member-facing `GET /api/market/nighthawk/record` route and the admin `GET /api/admin/nighthawk/analytics` route |
| **Severity** | P2 — outcome-honesty violation on member- and admin-facing return figures, the same failure class this file already fixed once (`win_rate`) but left unfixed on its average-return siblings |

### Root cause

`analytics.ts` is unusually careful about never rendering a fabricated `0%` when a ratio has no real evidence behind it — `winRate()`, `profitableRate()`, and `profitableRateEdge()` all explicitly return `null` (never `0`) when their denominator is empty, with extensive comments citing a real 2026-08-06 live incident ("0 targets / 2 stops / 20 opens... a hard '0% win rate' on a sample with two decided outcomes"). `buildRecordSegment()` goes further and explicitly names the SAME trap for average returns:

```ts
// Same false-zero trap winRate/profitableRate above are already guarded against: a
// non-empty `scoreable` set can still have ZERO rows with a computable return (e.g. every
// row missing next_day_close) if `avgOf`'s empty-array-defaults-to-0 fallback is reached
// through avgReturn — reporting a fabricated "+0.00%" instead of the honest "no evidence
// yet" null. Gate on rows that actually resolved a return, not on scoreable.length.
const scoreableReturns = scoreable.map(realizedReturnPct).filter((v): v is number => v != null);
...
avg_return_pct: scoreableReturns.length > 0 ? avgOf(scoreableReturns) : null,
```

This guard was applied **only** inside `buildRecordSegment()`. Every other average-return computation in the same file still goes through the unguarded helper:

```ts
function avgOf(values: number[]): number {
  if (values.length === 0) return 0;   // <- the exact trap buildRecordSegment's own comment names
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
function avgReturn(rows: NighthawkPlayOutcomeRow[]): number {
  return avgOf(rows.map(realizedReturnPct).filter((v): v is number => v != null));
}
export function avgLoserReturn(losers: NighthawkPlayOutcomeRow[]): number {
  return Math.min(0, avgReturn(losers));   // avgReturn([]) -> 0 -> min(0,0) -> 0
}
export function groupWithReturn(rows: NighthawkPlayOutcomeRow[]): NighthawkRecordCut {
  ...
  return { ..., avg_return_pct: avgReturn(rows), ... };  // unguarded
}
```

`NighthawkMetrics.avg_return_pct`, `.avg_winner_return_pct`, `.avg_loser_return_pct`, and `NighthawkRecordCut.avg_return_pct` (the shape behind `by_conviction`/`by_direction`/`by_sector`/`by_edition`) are all typed as plain `number` — never `number | null` — so there is no way for a caller to even represent "no evidence" for these fields today.

### Where this is definitely reachable, not narrow

- **`avg_winner_return_pct` / `avg_loser_return_pct`** (admin dashboard only, `getNighthawkMetrics`'s top-level output): `avgReturn(winners)` / `avgLoserReturn(losers)` fabricate a `0` the instant a window has **zero winners** or **zero losers** — an entirely routine occurrence (any losing streak with no target hits yet, or a hot streak with no stop-outs yet), not an edge case. `emptyMetrics()`'s own placeholder object hard-codes `avg_winner_return_pct: 0, avg_loser_return_pct: 0` for the fully-empty case too, so even the "there is definitely nothing to report" path bakes in the same fabricated value.
- **`avg_return_pct`** (member-facing `/api/market/nighthawk/record` AND admin route, top-level): fabricates `0` whenever `scoreable` is empty while `rows.length > 0` — i.e. every resolved row this window was `unfilled`/`pulled`/`stop_data_unavailable`. Less common than the winner/loser case but real and already contemplated by the file's own `isStopDataUnavailable` exclusion machinery.
- **`groupWithReturn`'s `avg_return_pct`** (`by_conviction`/`by_direction`/`by_sector`/`by_edition`, both routes): narrower — requires every row in that specific cut to have a `null` `realizedReturnPct` despite the cut itself being non-empty (e.g. a corrupt `entry_range_low`/`entry_range_high` pair that fails `entryRangeMid`'s validation on every row in the bucket). Real but rarer than the winner/loser case above.

### Blast radius (consumer inventory — why this isn't a one-file fix)

```
src/app/api/market/nighthawk/record/route.ts      — member-facing; avg_return_pct: Math.round(metrics.avg_return_pct * 100) / 100 (no null guard)
src/app/api/admin/nighthawk/analytics/route.ts    — admin-facing wire mapping
src/features/nighthawk/components/HawkRecordStrip.tsx — member-facing, renders record.avg_return_pct directly
src/features/nighthawk/components/PlaybookBoard.tsx    — member-facing, record.avg_return_pct >= 0 ? "+" : "" then Math.round(record.avg_return_pct)
src/features/nighthawk/command-deck/containers.tsx     — recordData.avg_return_pct ?? 0 (already defensively coalesces, interesting tell that a caller anticipated null even though the type never allowed it)
src/components/admin/AdminNightHawkDashboard.tsx  — admin-only; avg_winner_return_pct / avg_loser_return_pct / avg_return_pct across multiple table rows, fmtReturn(value: number) has no null branch
```

Note `containers.tsx` already writes `recordData.avg_return_pct ?? 0` — a caller independently suspected this field could be nullish even though nothing in the current type system allows it, which is a small tell that this gap has been noticed informally before.

### Why this is reported rather than fixed directly

The mechanical defect and its precedented fix are both completely clear — `buildRecordSegment()` already IS the reference implementation (`scoreableReturns.length > 0 ? avgOf(scoreableReturns) : null`), and this is purely a reporting-honesty fix, not a live-picks change. What makes it not a same-cycle "small/unambiguous" fix is the **consumer surface**: correctly widening `NighthawkMetrics`/`NighthawkRecordCut`'s average-return fields to `number | null` requires updating every listed consumer to render the null case (a "—" or omission, matching how `win_rate`/`win_rate_pct` already render their null case) rather than silently coercing `null` through arithmetic (`Math.round(null * 100)`, `null >= 0`, `fmtReturn(null)`), across both a member-facing route/components and an admin dashboard — six files touched for one root cause, which deserves a deliberate single PR with its own test coverage per surface rather than a rushed change late in an audit cycle.

### Suggested fix (for review, not applied here)

1. Add a `values.length > 0 ? ... : null` guard to `avgOf`-consuming call sites (`avgReturn`, `avgReturnEdge`, `avgLoserReturn`, `groupWithReturn`), mirroring `buildRecordSegment`'s existing pattern exactly.
2. Widen `NighthawkMetrics.avg_return_pct` / `.avg_return_pct_edge` / `.avg_winner_return_pct` / `.avg_loser_return_pct` and `NighthawkRecordCut.avg_return_pct` to `number | null`.
3. Update every listed consumer to render the null case explicitly (an em dash, matching the existing `win_rate_pct: null` → "—" convention already used elsewhere on the same routes/components).
4. Add regression tests: a window with real rows but zero winners (`avg_winner_return_pct` must be `null`, not `0`), zero losers (`avg_loser_return_pct`), and an all-excluded scoreable set (`avg_return_pct`) — closing the exact gap `buildRecordSegment`'s own tests already cover for its sibling field but the top-level metrics never got.
