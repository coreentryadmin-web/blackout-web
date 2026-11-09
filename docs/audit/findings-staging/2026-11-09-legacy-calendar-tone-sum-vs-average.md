> **kind:** FINDING

## Night Hawk Legacy calendar strip's day `tone` was derived from a raw per-day SUM while the displayed `net_premium_pct` is the AVERAGE — could paint a "+0%" day bullish-green or bearish-red — FIXED

| | |
|---|---|
| **Area** | Night Hawk Legacy pick-log board — `src/features/nighthawk/lib/legacy-board-table-utils.ts` (`legacyBoardCalendarBuckets`), rendered by `VectorBoardCalendar.tsx` |
| **Severity** | P3 — correctness/display (member-visible calendar-tile color contradicts the tile's own text; not a trading-decision bug) |
| **Status** | FIXED |

### Root cause

`legacyBoardCalendarBuckets` builds one calendar-strip tile per session day: `net_premium_pct`
(the number shown, e.g. `"+1%"`) and `tone` (the color class — `"up"`/`"down"`/`"flat"`, consumed
by `VectorBoardCalendar.tsx` as `is-${b.tone}` plus the magnitude-based intensity class) are
supposed to describe the same fact about the same day.

They did not. `net_premium_pct` is the real per-row AVERAGE premium for the day
(`net / withPremium.length`, rounded by magnitude), but `tone` was computed straight off the raw,
un-averaged SUM (`net`) against a fixed ±2 deadband:

```ts
const net = withPremium.reduce((s, r) => s + (r.premiumPct ?? 0), 0);
...
const tone = net > 2 ? "up" : net < -2 ? "down" : "flat";   // <- SUM, not average
...
net_premium_pct: ... Math.sign(net / withPremium.length) * Math.round(Math.abs(net / withPremium.length)) ...  // <- average
```

A sum scales with how many rows the day has; an average does not. The ±2 deadband makes sense
against a single day's *average* premium (a small, genuinely flat nudge), but not against a sum
that grows with row count — a day with enough small-premium rows trips the sum past the deadband
while the average, and therefore the number actually printed on the tile, stays at (or rounds to)
zero.

This was not introduced by a later refactor: `git show d7023ea7c` (PR #4746, 2026-09-10) shows
`net` was already the plain day sum from the very first version of this function, and every
subsequent fix to this same block (the pulled-play exclusion in that same PR, the stock-only-null
dilution fix in #4743917, the sign-bias rounding fix in #ccdbddc) corrected `net_premium_pct`'s
math without ever touching the `tone` line two lines above it — so the two values drifted further
apart with each fix rather than closer. The sibling `vectorBoardCalendarBuckets`
(`vector-board-table-utils.ts`) never had this split: it derives `tone` from the exact same `avg`
it reports, by construction, which is how this discrepancy was found (comparing the two "same
concept, two files" implementations side by side).

### Evidence

Reproduced directly against the pure function (`legacyBoardCalendarBuckets`, no network/DB):

```
10 Legacy rows, each pnlPct = +0.3% that session day
  sum  = 3.0   (> 2  -> old code: tone = "up",   bullish-green tile)
  avg  = 0.3   -> net_premium_pct rounds to 0    (tile text reads "+0%")

10 Legacy rows, each pnlPct = -0.3% that session day
  sum  = -3.0  (< -2 -> old code: tone = "down", bearish-red tile)
  avg  = -0.3  -> net_premium_pct rounds to 0    (tile text reads "+0%")
```

Both cases render a calendar cell whose text says `"+0%"` (a visually flat day) colored
bullish-green or bearish-red respectively — a direct, member-visible contradiction between the
tile's own number and its own color, on a plausible real-world shape (several small-premium
Legacy plays open on the same session day; Legacy's digest routinely carries more than 2-3 plays
per session).

Confirmed RED→GREEN via `git stash` on the source file alone: both new regression tests fail
pre-fix (`'down' !== 'flat'` / `'up' !== 'flat'`, exactly reproducing the scenario above), pass
after restoring the fix. Full `legacy-board-table-utils.test.ts` suite: 17/17 green post-fix.
`npx tsc --noEmit` clean.

### Blast radius

`legacyBoardCalendarBuckets` has exactly one call site (`LegacyPickLogBoard.tsx`'s calendar
strip), so the fix is fully contained to that one tile. Checked the sibling
`vectorBoardCalendarBuckets` (Vector's own board) for the same shape — it was already correct
(derives `tone` from its own `avg`, never from an un-averaged sum) and needed no change. Checked
`vectorBoardScorecard` (`vector-board-row-utils.ts`, the session-wide scorecard shared by both
boards) separately — it has no `tone` field at all (its tones are derived per-row via
`premiumPctTone`/`meterTone` directly from each row's own `premiumPct`, never from a day-level
sum), so it does not share this defect.

### Fix rationale

Compute the day's average once (`avg = withPremium.length ? net / withPremium.length : 0`) and
derive **both** `tone` and `net_premium_pct` from it, matching the pattern Vector's sibling
function already uses. This keeps the existing ±2-point deadband semantics (now correctly applied
to the average it was always meant to gate, not the sum) and keeps every other piece of this
function's logic — the pulled-play exclusion, the stock-only-null-premium exclusion, the
sign-biased rounding — completely unchanged; only the input to the `tone` comparison moves from
`net` to `avg`.

### Regression tests added

`src/features/nighthawk/lib/legacy-board-table-utils.test.ts`:
- `legacyBoardCalendarBuckets: tone tracks the AVERAGE premium, not a row-count-scaled SUM` — 10
  rows at +0.3% each; asserts `tone === "flat"` alongside `net_premium_pct === 0`.
- `legacyBoardCalendarBuckets: tone tracks the AVERAGE premium on the loss side too` — the mirror
  case at -0.3% each.
