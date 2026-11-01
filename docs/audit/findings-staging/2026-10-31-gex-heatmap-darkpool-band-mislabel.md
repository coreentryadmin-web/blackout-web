# Thermal GEX Heatmap — Gamma Profile's dark-pool overlay snapped far-outside-the-band prints onto the nearest edge row, mislabeling their price — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P2 (member-facing, Gamma Profile panel, every lens, `/heatmap`): a dark-pool price level could render on a strike row far from its real price, with nothing on screen distinguishing it from a genuinely in-band level. |
| **Area** | Thermal GEX Heatmap — `src/features/thermal/components/GexHeatmap.tsx` (`ExposureProfile`'s `darkPoolByRow` memo). |
| **Status** | FIXED |

### Root cause

`ExposureProfile`'s `darkPoolByRow` memo resolves each server-supplied dark-pool price level to
the nearest *rendered* profile row (by strike), so the overlay line can be drawn across that row.
The code had an inline comment stating the intended guard:

```ts
// Skip levels far outside the band (> half the strike step from any row).
if (bestIdx >= 0 && !map.has(bestIdx)) map.set(bestIdx, level);
```

but no code actually enforced it — `bestIdx` was always the nearest row *found*, however far away
that still was, and the condition only checked that a row existed and hadn't already been claimed.
So a level arbitrarily far from every rendered strike was still mapped onto whichever row happened
to be closest (almost always the top or bottom edge row of the band), and drawn as if that print
occurred at that strike.

This was reachable because the two overlays this panel renders are NOT symmetric in how they're
scoped server-side (`src/app/api/market/gex-heatmap/route.ts`):

```ts
const [flow_by_strike, dark_pool_levels] = await Promise.all([
  buildFlowByStrike(ticker, strikes),   // IS passed the rendered `strikes`
  buildDarkPoolLevels(ticker),          // NOT passed `strikes` at all
]);
```

`buildFlowByStrike` is constrained to the matrix's own strike axis, so its overlay can never fall
outside the rendered band. `buildDarkPoolLevels` independently pulls the ticker's top-5 dark-pool
prints by notional from the raw tape (`fetchUwDarkPool`) over its own lookback window — a price
level with no relationship to the currently-rendered strike band. Any print from a materially
different price than today's (a pre-earnings-gap print, or simply a name whose rendered strike band
happens to be narrow) sits structurally outside `rows`, and the missing guard let it render anyway.

### Evidence

Extracted the real `darkPoolByRow` useMemo body verbatim from the component source (via
`new Function(...)`, stripping only the one TS-only `Map<number, DarkPoolLevel>` generic so the
exact shipped control flow runs as plain JS) and exercised it directly:

- Fixture: a normal 20-row SPY-shaped band, 1-pt strikes, 610→591.
- Inputs: one genuinely in-band print (602) and one print 150pts outside the band (450, e.g. a
  pre-earnings-gap tape print).
- **Pre-fix (unmodified source)**: `map.size === 2` — the 450 print rendered on row 19 (strike
  591, the bottom edge), i.e. the panel drew a dark-pool line at 591 purporting to represent a
  print that actually happened at 450, ~29% away from where it was shown.
- **Post-fix**: `map.size === 1` — only the genuinely in-band 602 print renders; the far-outside
  print is dropped rather than mislabeled.

RED→GREEN proven directly on the component source (not a hand-written mirror): `git stash` on
`GexHeatmap.tsx` alone (keeping the new test), confirmed 2 of 3 new test cases fail against the
unfixed source (the "far outside the band" case produces `map.size === 2` where `1` was asserted,
and the band-distance-guard source-presence check also fails), restored the fix, confirmed all 3
pass.

### Fix

Derive the typical strike spacing from `rows` itself (minimum positive gap between adjacent rows —
the same technique `depthBandForPrice`/`gex-depth.ts` already uses for its own band step, since
different tickers/strike bands have different spacing) and skip mapping a level whose nearest row
is farther than half that spacing:

```ts
let step = Infinity;
for (let i = 1; i < rows.length; i++) {
  const gap = Math.abs(rows[i - 1].strike - rows[i].strike);
  if (gap > 0 && gap < step) step = gap;
}
const maxDist = Number.isFinite(step) ? step / 2 : Infinity;
...
if (bestIdx >= 0 && bestDist <= maxDist && !map.has(bestIdx)) map.set(bestIdx, level);
```

### Fix rationale

Derived the step from the rendered rows rather than taking it as a prop or assuming a fixed value,
because different tickers (SPX vs a single-name equity) and different expiry/strike scopes render
bands with very different spacing — a fixed threshold would either over-trigger on wide-stride
tickers or under-trigger on narrow ones. Matches the existing `depthBandForPrice` precedent in the
same feature area rather than inventing a second approach. Deliberately left the "half the strike
step" threshold the comment already specified (rather than widening it) since it already states
the intended tolerance; only the missing enforcement was the bug.

### Blast radius

Single memo, single consumer (`ExposureProfile`'s dark-pool overlay rendering and its legend count
at `darkPoolByRow.size`). The HELIX flow overlay (`flowByStrike`) is unaffected — it is already
server-scoped to `strikes` and never had this gap. No other component reads `darkPoolByRow`. No
server-side change; `buildDarkPoolLevels` continues to return the ticker's real top prints
unfiltered, which is correct — the filtering belongs at the point where a price is placed onto a
specific rendered row, not at the data-fetch layer (a member switching expiry scope or searching a
different ticker changes the rendered band without refetching the overlay).

### Regression test

`src/features/thermal/components/GexHeatmap-darkpool-band.test.ts` (new, 3 tests) — extracts and
executes the real `darkPoolByRow` memo body from the component source rather than a hand-written
mirror, so it cannot silently drift from the shipped logic:
1. A band-distance guard (`bestDist <= maxDist`) must be present in the source, not just stated in
   a comment.
2. A print far outside the rendered band must be dropped, not snapped onto the nearest edge row;
   a genuinely in-band print on the same input set must still render.
3. A print within tolerance of the very edge row still renders (guards against over-tightening the
   fix into a false negative).

Scoped run: `GexHeatmap-darkpool-band.test.ts` (3/3), plus the file's two pre-existing sibling
regression tests `GexHeatmap-matrix-freshness.test.ts` (2/2) and `GexHeatmap-header-change-pct.test.ts`
(4/4) — all pass (9/9 total). `npx tsc --noEmit` clean repo-wide. `npx eslint` on the touched files:
0 errors (3 pre-existing, unrelated `react-hooks/exhaustive-deps` warnings elsewhere in the same
file, untouched by this change).
