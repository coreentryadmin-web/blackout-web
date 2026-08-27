# AUTO node-count floor overrode candle-share target far more than intended — FIXED

> **kind:** FINDING

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Component** | `src/features/vector/lib/vector-adaptive-nodes.ts` |
| **Reported** | 2026-08-27, live member report ("GEX ladder density issue" — candles squeezed on a quiet, coarse-stepped single name; part of the same day's chart-fit-without-scroll ask) |

## Root cause

`adaptiveAutoNodeCount` (AUTO node density) is supposed to pick "the largest row count ≤ the
timeframe cap whose row-aware window keeps candles ≥ `AUTO_MIN_CANDLE_SHARE` of the pane." In
practice it does not honor that on a quiet, coarse-stepped ticker, because `AUTO_MIN_ROWS_PER_SIDE`
(12) is applied as a hard floor **regardless of whether it satisfies the share target**: the search
loop walks the row count down from the timeframe cap until it finds one that fits the candle-share
budget, but the moment it finds one, it returns `Math.max(AUTO_MIN_ROWS_PER_SIDE, n)` — silently
discarding a smaller, correctly-fitting `n` in favor of the floor.

Measured against the exact NVDA fixture already in this repo's own test suite (spot 219.28, $2.50
strikes, a quiet ~2.1-point session): the share-target math wants as few as 2 rows to hold 16%
candle share, but the floor forces 12 regardless — and 12 rows on a $2.50 ladder needs `12 × 2.5 /
219.28 ≈ 13.7%` of spot just for the row count, before the chart's own wall-reveal widening even
runs on top. That 13.7% floor is what a quiet session's ~1%-range candles get squeezed against,
independent of every other clamp downstream (`MIN_CANDLE_SHARE_OF_PANE` in
`vector-price-range.ts`, which is a genuine 35% floor — but it can only shrink what AUTO handed it,
never rescue a row count that was already too large for the session).

## Fix

- `AUTO_MIN_CANDLE_SHARE`: 0.16 → 0.22 (still under the axis's own 0.35 floor, but closer to it, so
  AUTO's row-count decision and the axis's eventual clamp pull in the same direction).
- `AUTO_MIN_ROWS_PER_SIDE`: 12 → 8 (still meaningfully more than the "~7 rows" complaint this floor
  was introduced to fix on 2026-08-24, but a smaller override of the share target on a quiet
  session). On the same NVDA fixture this drops the floor's own axis need from ~13.7% of spot to
  ~9.1% — a real, measured reduction, not a guess.

SPX and other dense-strike ladders are unaffected — their own geometry already satisfies the (now
slightly higher) share target at the full timeframe cap, so they never hit either floor (confirmed
by the pre-existing "SPX keeps timeframe AUTO cap" test, which still passes unchanged).

## Tests

`vector-adaptive-nodes.test.ts`: updated the existing NVDA-floor assertion for the new floor value;
added a new regression test asserting the floor's own axis-span need is under 12% of spot for the
exact reported fixture (was ~13.7% before this fix). `tsc --noEmit` clean; full suite 10991 pass /
0 fail / 2 pre-existing skips; `npm run build` clean.
