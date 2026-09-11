> **kind:** FINDING

# Legacy scorecard reported a fabricated "Hit rate 0%" on a day where every play was pulled pre-open

| Field | Detail |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (member-facing, misleading outcome-honesty stat on the live board) |
| **Component** | `src/features/nighthawk/lib/vector-board-row-utils.ts` (`vectorBoardScorecard`, shared by `LegacyPickLogBoard.tsx` and `VectorPickLogBoard.tsx`) |
| **Found via** | Live UI screenshot (`proxy-browser.cjs` against `/nighthawk?view=legacy`), aggressive improvement-hunting pass, 2026-09-11 |

## What was broken

Captured a live screenshot of today's Legacy board (both AAPL and SWKS pulled pre-open by the
Cortex `gex-walls` veto documented in earlier findings this session). Both rows show strongly
positive counterfactual premium moves (AAPL +85%, SWKS +162%, SWKS at "100% to stock target"),
yet the board's own summary line read: **`2 picks · 0 winners · 0 runners · 2 closed · Hit rate
0%`**.

Traced to `vectorBoardScorecard`'s hit-rate fallback:

```js
const hitDenom = closedResolved > 0 ? closedResolved : rows.length;
const hitNum = closedResolved > 0 ? closedWinners : winners;
```

`closedResolved`/`closedWinners` deliberately exclude never-entered pulls (per this same file's
own established principle, added 2026-09-10 for a different live bug — a pulled play's
counterfactual return must never count as an achieved "hit", since no capital was ever live on
it). But when `closedResolved` is 0, the code falls back to `rows.length`/`winners` — and that
fallback was only ever tested against a **mixed** population (a pull plus real open/closed
rows), where real rows dominate and the number happens to come out sensible. It was never tested
against a session where **every** published play was pulled: `closedResolved` stays 0 (correctly
— no real resolution happened), but the fallback denominator `rows.length` is then 100% phantom
rows, and `winners` (real rows with status `"winner"`) is 0 by construction since there are no
real rows at all. The result — "0%" — reads as "today's picks lost", when the honest state is
"no capital was ever at risk today, and the counterfactual read is actually strongly positive."

## What changed

The fallback denominator now excludes never-entered pulls the same way `closedResolved` already
does: `nonPulledTotal = rows.filter(r => !isNeverEnteredPull(r)).length`. When every row for the
day is pulled, `nonPulledTotal` is 0, and the scorecard's existing `hitDenom > 0 ? ... : null`
guard (already present, unchanged) correctly returns `null` — "no resolved data" — instead of a
fabricated 0%. A mixed day (a pull alongside real open/closed rows) is unaffected, since the real
rows already dominated `nonPulledTotal` under the old `rows.length` fallback too.

## Evidence

- New regression test reproducing today's exact live population (2 rows, both `statusLabel:
  "PULLED"`, premiumPct +85/+162 matching AAPL/SWKS) — RED before the fix (`hitRate: 0`), GREEN
  after (`hitRate: null`). Full file: 12/12 pass (was 11/12 before the fix).
- All 6 pre-existing scorecard/pull tests in the same file still pass unmodified — the fix only
  changes behavior for the all-pulled case, confirmed by walking each existing test's population
  through the new formula by hand (mixed-population cases were already dominated by real rows, so
  `nonPulledTotal` and the old `rows.length` fallback agree there).
- `legacy-board-table-utils.test.ts` (11/11) — the sibling file exercising the same shared
  scorecard from Legacy's own row-building path — unaffected.
- `tsc --noEmit` clean.

## Blast radius

`vectorBoardScorecard` is shared by both `LegacyPickLogBoard.tsx` and `VectorPickLogBoard.tsx`,
but `isNeverEnteredPull` (`row.statusLabel === "PULLED"`) is stamped exclusively by Legacy's own
`legacyVectorStatus()` — Vector's rows never carry that label (confirmed by grep: only one
call site in the whole codebase produces it). So this fix changes Vector desk's numbers in zero
cases; it is scoped entirely to Legacy's pulled-play days.

## Fix rationale

Chose to exclude pulled rows from the fallback denominator (matching the existing
`closedResolved` exclusion) rather than, say, special-casing "all rows pulled" as its own branch,
because the same root issue — the fallback denominator including phantom rows — degrades
proportionally on any day with a *mix* of pulls and reals, not just a 100%-pulled day; the fix
generalizes correctly rather than patching only today's specific symptom.
