> **kind:** FINDING

## Meridian OPEX cross-market top gainer/loser pick is non-deterministic on an exact `session_pct` tie — FIXED

**Status:** FIXED (regression test added, RED→GREEN confirmed).

### Root cause

`rankOpexSessionMovers` (`src/lib/meridian/meridian-opex-cross-market-core.ts`) screens
Polygon's whole-market grouped-daily rows for liquid tickers, computes each one's session
percent change (`pctChange`), and then picks the single "top gainer" / "top loser" to surface
in the Meridian OPEX cross-market report:

```ts
const sorted = [...candidates].sort((a, b) => b.session_pct - a.session_pct);
return { top_gainer: sorted[0] ?? null, top_loser: sorted[sorted.length - 1] ?? null };
```

This is the exact `[0]`-after-unstable-sort shape this session has already found and fixed six
times elsewhere (`gex-cross-validation-core.ts` x2, `gex-wall-levels.ts`, `strike-gex-lookup.ts`,
`meridian-gex-reads.ts`, `greek-exposure-summary.ts`): the sort has no secondary key. JS's
`Array#sort` is stable, so on an exact tie in `session_pct` the "winner" is whichever candidate
happened to appear earlier in `rows` — i.e. whichever row Polygon's grouped-daily response
listed first that day. That has nothing to do with which ticker is actually the bigger mover;
it is an artifact of upstream response ordering.

Exact ties are not a theoretical edge case here: `pctChange` rounds its output to 2 decimal
places (`.toFixed(2)`), and this function scans the *entire* liquid, price/volume-filtered
market (Polygon grouped-daily, ~thousands of rows after the ticker-pattern/price/volume
filters). Across that population it is routine for two unrelated tickers to land on the exact
same rounded percentage (e.g. both moving from $100.00 to $105.00 → "+5.00%"), especially on
quiet, low-dispersion session days where many names cluster near a similar move size.

### Evidence

Added a test with two tickers (`ALPHA`, `ZEBRA`) moving by the identical session_pct, fed to
`rankOpexSessionMovers` in two different input orders (`rowsA`: ZEBRA first; `rowsB`: ALPHA
first — otherwise byte-identical data).

- **Before the fix (RED):** `rowsA` reported `top_gainer.ticker === "ZEBRA"` and
  `top_loser.ticker === "ZEBRA"` (first-in-array wins both ends of the tie); `rowsB` would have
  reported `"ALPHA"` for the same tied data — purely a function of array order, not the
  underlying prices.
- **After the fix (GREEN):** both input orders report the same, ticker-deterministic result
  (`top_gainer === "ALPHA"`, `top_loser === "ZEBRA"`) regardless of which row came first.

Full test suite for the file: `6 pass / 0 fail` after the fix (was `5 pass / 1 fail` on the new
test alone before it, with the pre-existing 5 tests unaffected either way).

### Blast radius

`rankOpexSessionMovers` has exactly one call site — `buildMeridianOpexCrossMarket`
(`src/lib/meridian/meridian-opex-cross-market.ts:59`), which stores the per-date mover into
`moversByDate` and surfaces it in the Meridian OPEX cross-market report consumed by the
Meridian desk. Checked the one other function in this file with a similar "pick the extreme"
shape, `summarizeMag7Sessions` (linear max/min scan, not a sort+index): it is also technically
order-dependent on an exact tie, but it only ever receives the fixed 7-member Mag7 list rather
than a whole-market scan, so an exact tie there is vanishingly unlikely — left untouched as
out of scope for this fix rather than bundling an unrelated, much lower-risk change in.

### Fix rationale

Added a secondary sort key — tie-break by `ticker` ascending via `localeCompare` — matching the
established fix pattern for this exact bug shape elsewhere in the codebase. This makes the pick
deterministic and reproducible (same inputs always produce the same top gainer/loser,
regardless of incidental array order) without changing any non-tied result. An alternative
considered and rejected: tie-breaking by `volume` (favor the more liquid name) — rejected
because it adds a second, less obviously "fair" dimension and the goal here is determinism, not
a different ranking philosophy; alphabetical tie-break is the same choice already made for the
sibling bugs in this vein.

### Files changed

- `src/lib/meridian/meridian-opex-cross-market-core.ts` — added secondary tie-break to
  `rankOpexSessionMovers`'s sort.
- `src/lib/meridian/meridian-opex-cross-market-core.test.ts` — added the RED→GREEN regression
  test.
