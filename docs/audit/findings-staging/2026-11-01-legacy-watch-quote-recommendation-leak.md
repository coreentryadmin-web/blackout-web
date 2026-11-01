> **kind:** FINDING

## Night Hawk Legacy: WATCH (not-yet-entered) plays could show a live "SELL"/"TRIM" verdict — FIXED

**Status:** Fixed, regression tests added (`use-legacy-quotes.test.ts`, `adapters.test.ts`).

### Root cause

`overlayLegacyQuotes` (`src/features/nighthawk/command-deck/use-legacy-quotes.ts`) overrides a
Legacy play's `recommendation`/`recNote` with a live, action-oriented verdict once the
underlying stock's price crosses the play's published stop or target level:

```ts
if (target != null && stop != null && p.status !== "CLOSED" && p.status !== "SKIP") {
  const atStop = isLong ? q.price <= stop : q.price >= stop;
  const atTarget = isLong ? q.price >= target : q.price <= target;
  if (atStop) {
    recommendation = "SELL";
    recNote = `Stock at stop level ($${stop.toFixed(2)}) — cut the position to preserve capital.`;
  } else if (atTarget) {
    recommendation = "TRIM";
    recNote = `Stock at target ($${target.toFixed(2)}) — take profit or trail the stop.`;
  }
}
```

The exclusion list covers `CLOSED` and `SKIP` but is missing `WATCH`. A `WATCH` play has **no
open position** — `terminalPlayFromEdition` (`adapters.ts`) sets `status: "WATCH"` for every
evening-edition play before the next morning's 9:15am ET morning-confirm cron runs, and keeps it
`WATCH` all session long for a `DEGRADED`/`UNVERIFIED` confirm verdict too (only `CONFIRMED` maps
to `OPEN`, only `INVALIDATED`/severe-pulled maps to `SKIP`). The published stop/target levels are
static numbers set the evening before, so the underlying can easily trade through either one
overnight or pre-market, well before (or entirely instead of) any real entry.

When that happened, this override stamped `"SELL — Stock at stop level... cut the position to
preserve capital."` or `"TRIM — ... take profit or trail the stop."` straight into
`play.recommendation`/`play.recNote`. `LegacyPlayDetailPanel.tsx` renders both verbatim in its
"Verdict" band (`<span className="...is-{rec}">{play.recommendation}</span>` plus the `recNote`
line directly beneath it) with **no status gating of its own** — so a member opening a WATCH
play's detail panel would see a confident "SELL" badge telling them to exit a position that was
never opened.

This is the direct sibling of the fix already shipped for `overlayLegacyOptionMarks`'s
`pnlPct`/`execPnlPct`/`execMark` (#7105, merged earlier this session) — that fix withheld a live
*option* P&L number for WATCH/SKIP plays; this bug is the same root cause (a WATCH play has no
position to report on) surfacing in the sibling *stock-quote* overlay's `recommendation`/`recNote`
fields instead.

### Evidence

- **RED (pre-fix):** added two tests mirroring the existing CLOSED/SKIP exclusion tests but for
  `status: "WATCH"` — both failed: `price at stop -> recommendation 'SELL'` (expected `'HOLD'`),
  `price at target -> recommendation 'TRIM'` (expected `'HOLD'`).
- Running the FULL existing suite for this file surfaced 4 pre-existing tests in
  `adapters.test.ts` (`overlayLegacyQuotes: LONG/SHORT at stop/target → recommendation
  SELL/TRIM`) that built their fixture play via `terminalPlayFromEdition({...})` **without**
  `morning_status` — which resolves to `status: "WATCH"` by construction (`ms == null` branch) —
  and asserted the override fired. These tests were unintentionally encoding the bug: the
  override is only meaningful for an entered position, so they're updated to pass
  `morning_status: "CONFIRMED"` (status `OPEN`) to represent that, and a new test documents the
  correct WATCH behavior on the exact same NVDA fixture.
- **GREEN (fix applied):** `use-legacy-quotes.test.ts` 18/18 pass; `adapters.test.ts` 162/162
  pass (4 updated + 1 new WATCH-specific test, all green).
- `npx tsc --noEmit` clean on the whole project.

### Blast radius

Only `overlayLegacyQuotes`'s stop/target override branch changed. `overlayLegacyOptionMarks`
(the option-mark overlay, already fixed in #7105) is unaffected — it never reads
`recommendation`/`recNote`. The one rendering consumer that surfaces these fields verbatim is
`LegacyPlayDetailPanel.tsx`'s verdict band; no other component reads `play.recommendation` for a
LEGACY-horizon play (`PlayTerminal.tsx`'s own `liveRec`/`badge` logic is horizon-gated to
`ZERO_DTE`/`SWING`/`PLAN` exit models and does not special-case LEGACY). `progress`/`stockMovePct`/
`stockPeakPct`/`stockTroughPct`/`stockPrice`/`stockChangePct` in the same function are informational
(gauge/context fields, not an action verdict) and are deliberately left unchanged.

### Fix rationale

Added `&& p.status !== "WATCH"` to the existing exclusion condition — the same pattern already
used for `CLOSED`/`SKIP`, and the same `notYetEntered` concept `overlayLegacyOptionMarks.ts`'s own
#7105 fix already names for this exact state. Rejected: changing the override's *language* to be
WATCH-aware (e.g. "would be at the stop if entered") instead of suppressing it — the simpler,
more defensible fix is that a position management verdict should not exist at all for a setup
that was never entered, matching `managementFor()`'s own explicit WATCH copy elsewhere in this
codebase ("Candidate only — not committed... no position management until entry").

### Deliberately left unchanged

- The `progress`/`stockMovePct`/`stockPeakPct`/`stockTroughPct` computations in the same function
  — these are informational gauge fields (where price sits vs. the planned levels), not an action
  verdict, and are useful context for a WATCH candidate too.
- `overlayLegacyOptionMarks.ts` — already fixed for the equivalent option-P&L gap in #7105.
