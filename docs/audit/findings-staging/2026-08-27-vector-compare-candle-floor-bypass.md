# Compare mode's live frame bypassed the candle-share floor entirely — FIXED

> **kind:** FINDING

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Component** | `src/features/vector/components/VectorChart.tsx` |
| **Reported** | 2026-08-27, self-audit requested after the day's single-chart candle-squeeze/layout fixes ("Compare mode ... was explicitly left untouched in all these fixes — worth a look since it has its own separate wall/bead tuning that's aged out of sync") |

## Root cause

The 2026-08-26 candle-squeeze fix added a candle-share floor (`withCandleFloor` composed with
`MIN_CANDLE_SHARE_OF_PANE`/`candleShareSpanCapPct`) to the chart's live/default (non-session) frame,
matching protection session-overview already had. That fix explicitly excluded Compare-compact
panes: `} else if (!compareCompactBeadsRef.current) { beadViewPct = withCandleFloor(...); frameSpanPct
= beadViewPct; }` — so for a Compare pane in its live frame, `frameSpanPct` stayed `null`, and the
downstream `clampPriceRangeSpan` call (gated on `frameSpanPct != null`) never ran at all. That is
the identical bug class the fix exists to close, arguably worse for Compare since
`COMPARE_BEAD_VIEW_MAX_PCT` (24%) is a wider hard cap than standalone's `BEAD_VIEW_MAX_PCT` (20%).

The exclusion comment ("Compare-compact is deliberately left untouched — its wider fixed window is
tuned for short panes needing more rows visible") predates every fix that shipped today and cites
no measured evidence, unlike its sibling constants (which all reference specific member reports and
dates) — it read as an unexamined assumption once actually checked against the new protection.

## Fix

Removed the `!compareCompactBeadsRef.current` guard. Compare's live frame now runs through the same
`withCandleFloor(rowAwareSpanPct(...))` composition as standalone, just with its own wider hard cap
(`COMPARE_BEAD_VIEW_MAX_PCT` instead of `BEAD_VIEW_MAX_PCT`) so the "more rows visible in a short
pane" intent is preserved — the floor only ever *tightens* a window the ladder wanted wider, never
widens one, so this cannot regress Compare's existing row-visibility behavior; it only stops a
pathological squeeze the same way standalone's fix already does.

## Blast radius

Single closure in `VectorChart.tsx`'s `autoscaleInfoProvider` — the only place
`compareCompactBeadsRef` gated this specific branch. No other consumer of `compareCompactBeadsRef`
touched.

## Tests

`vector-chart-viewport.test.ts` (components, source-text): new regression test asserting the
exclusion branch is gone and Compare now composes its own hard cap into the same
`withCandleFloor`/`rowAwareSpanPct` call. `tsc --noEmit` clean; full suite 10992 pass / 0 fail / 2
pre-existing skips; `npm run build` clean.
