## Night Hawk Vector/Legacy board calendar tiles' `net_premium_pct` had the same sign-bias rounding tie as fmtPct/debrief.ts/trade-explanation.ts — three independent copies of the same average, all missed by today's earlier fix passes

> **kind:** `FINDING`

### Summary
`JavaScript.Math.round()` always rounds a `.5` tie toward `+Infinity` (`Math.round(-2.5) === -2`,
not `-3`), so a plain `Math.round(x)` applied to a SIGNED average under-reports a loss's
magnitude exactly at the tie, while the identical-magnitude gain (`Math.round(2.5) === 3`) rounds
correctly away from zero. This is the same bug class fixed earlier today (2026-11-09) across
`fmt-money.ts`'s `fmtPct`, Night Hawk's `debrief.ts`/`trade-excursion-graphic.ts`/
`play-card-display.ts`, `trade-explanation.ts`'s `fmtPts`/`fmtR`, `spx-desk-merge.ts`,
`gamma-desk.ts`, `vector-technicals.ts`, and `thermal-discord-extras.ts` — but every one of those
passes grepped for the formatter-shaped call sites and missed this one, because it's not a
formatter: it's an aggregation ("Net premium" tile) that happens to round a signed average.

Three independent implementations of the exact same "blend this session's/day's signed
`premiumPct` across rows" concept all share the defect, because each board (Vector live,
Vector-by-session-calendar, Legacy) reimplements it separately rather than sharing one helper:

1. `src/features/nighthawk/lib/vector-board-row-utils.ts` — `vectorBoardScorecard`'s
   `netPremiumPct: Math.round(sumPct / pctN)`.
2. `src/features/nighthawk/lib/vector-board-table-utils.ts` — `vectorBoardCalendarBuckets`'s
   `net_premium_pct: Math.round(avg)`.
3. `src/features/nighthawk/lib/legacy-board-table-utils.ts` — `legacyBoardCalendarBuckets`'s
   `net_premium_pct: Math.round(net / withPremium.length)`.

All three average real, already-live-confirmed SIGNED inputs (`row.premiumPct`/`play.pnlPct`,
the per-play option-premium % P&L — confirmed negative on real losing plays by this file's own
pre-existing tests, e.g. SIG `-82%`/`-80.73%` fixtures) and feed a member-facing "Net premium"
number: the live scorecard tile, and the Vector/Legacy board calendar tiles rendered by
`VectorBoardCalendar.tsx`'s `fmtSigned` (per `legacy-board-table-utils.ts`'s own comment: "the
tile's render layer... interpolates the number as-is with no rounding").

### Evidence
Pre-fix (reproduced by the new regression tests, run through the real exported functions, not a
reimplementation):

```
vectorBoardScorecard([{premiumPct:-2}, {premiumPct:-3}]).netPremiumPct        → -2  (expected -3)
vectorBoardCalendarBuckets([{premium:-2}, {premium:-3}]).net_premium_pct      → -2  (expected -3)
legacyBoardCalendarBuckets([{pnlPct:-2}, {pnlPct:-3}]).net_premium_pct        → -2  (expected -3)
```

`(-2 + -3) / 2 = -2.5` in all three; `Math.round(-2.5) === -2` (ties toward `+Infinity`), so each
tile under-reports a two-play losing day's average magnitude by a full percentage point relative
to how it would report the identical-magnitude gain (`(2 + 3) / 2 = 2.5 → Math.round(2.5) === 3`).

RED → GREEN: one new test per file (three total, in `vector-board-row-utils.test.ts`,
`vector-board-table-utils.test.ts`, `legacy-board-table-utils.test.ts`) fails pre-fix exactly as
shown above (confirmed via `git stash` isolating only the three source-file edits), passes
post-fix. Full suite of the three touched test files: 36/36 pass (33 pre-existing + 3 new).
`npx tsc --noEmit` clean.

### Fix
`Math.sign(x) * Math.round(Math.abs(x))` in place of `Math.round(x)` at each of the three call
sites — rounds the magnitude correctly regardless of sign (a tie always rounds away from zero),
and leaves every non-negative call site in these files (`hitRate`, `winnersFloorPct`,
`runnerPipelinePct`, `avgGivebackPct`, all ratios of non-negative counts/premiums) byte-identical,
since `Math.sign` of a non-negative number is `1` (or `0` at exactly zero, multiplying through
harmlessly). Same convention already shipped today in `round-floats.ts`, `shift-math.ts`'s
`fmtShiftPercentForStrike`/`wallStrengthShift`, and `thermal-discord-extras.ts`'s `fmtShiftPct`.

Deliberately left untouched: `vectorBoardRowGivebackPct`'s `Math.round(100 - capturedPct)`
(`capturedPct` is clamped `[0,100]` via `Math.max(0, Math.min(100, ...))` beforehand, so the
input to `Math.round` here is always non-negative — no tie-sign issue is reachable); every other
`Math.round` in these three files, which are confirmed non-negative ratios by construction.

### Blast radius
Three files, three independently-maintained copies of the same concept, as listed above. All
three are live member-facing numbers: `vectorBoardScorecard.netPremiumPct` drives the Vector
board's live scorecard tile; `vectorBoardCalendarBuckets`/`legacyBoardCalendarBuckets`'s
`net_premium_pct` drive the Vector and Legacy board calendar tiles respectively (both rendered,
unrounded-passthrough, by the shared `VectorBoardCalendar.tsx`). No other file in this family
(`legacy-board-table-utils.ts`'s other `Math.round` call, `vector-pick-log-board-utils.ts`, etc.)
reimplements this specific signed-average-then-round shape — checked by grep for `Math.round`
near `pct`/`avg`/`sum` across `src/features/nighthawk/lib/**` outside the three fixed call sites.

### Why this wasn't caught by prior fix passes today
Every earlier pass in this bug class (fmtPct, debrief.ts, trade-explanation.ts, spx-desk-merge.ts,
gamma-desk.ts, vector-technicals.ts, thermal-discord-extras.ts) found its instance by grepping for
a FORMATTER — a function whose name or immediate context signals "this prints a signed number"
(`fmtPct`, `signPct`, `round2` feeding a `+`/`-` prefix). These three call sites are not
formatters at all; they are plain aggregation code inside a scorecard/calendar-bucket builder,
where `Math.round(avg)`/`Math.round(sumPct / pctN)` reads, at a glance, like an ordinary
percentage rounding with nothing marking the input as signed. It took independently reading each
"Net premium" aggregator's full averaging logic — not just grepping call-site names — to notice
all three average a confirmed-signed field (`premiumPct`/`pnlPct`) rather than a 0-100 ratio.

| **Status** | FIXED — this PR. |
