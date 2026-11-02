> **kind:** FINDING

## `clampPriceRangeSpan` can clip the real candle range off-axis when it exceeds the frame's span cap — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **File** | `src/features/vector/lib/vector-price-range.ts` |
| **Function** | `clampPriceRangeSpan` |
| **Severity** | P2 — live visual defect on the Vector chart's session-overview price axis during volatile sessions |

### Root cause

`clampPriceRangeSpan` shrinks an over-wide autoscale price band to a spot-centered window of at
most `maxSpanPct * spot`, while its own doc comment and contract promise to keep `mustInclude`
(the real candle high/low range) visible. It does this with two sequential, one-sided fixups:

```ts
let min = spot - maxSpan / 2;
let max = spot + maxSpan / 2;
if (mustInclude.minValue < min) {
  min = mustInclude.minValue;
  max = min + maxSpan;
}
if (mustInclude.maxValue > max) {
  max = mustInclude.maxValue;
  min = max - maxSpan;
}
return { minValue: min, maxValue: max };
```

Each `if` re-derives the OTHER bound from the one it just fixed, assuming `mustInclude`'s own
span fits inside `maxSpan`. When `mustInclude`'s span is actually WIDER than `maxSpan`, the
second fixup overrides the first and silently drops the edge the first fixup had just covered.

Concretely, with `spot=100`, `maxSpan=10`, `mustInclude=[90,108]` (span 18 > cap 10):
- Step 1 (`mustInclude.minValue(90) < min(95)`): `min=90`, `max=100`.
- Step 2 (`mustInclude.maxValue(108) > max(100)`): `max=108`, `min=98`.
- Final: `[98, 108]` — `mustInclude.minValue` (90) is now OUTSIDE the returned window, even
  though the function's entire job was to keep it in view.

This is reachable, not a contrived edge case: in `VectorChart.tsx`, `mustInclude` is
`res.priceRange` — the real autoscale band over the SESSION's visible candles (its actual
high/low) — while the span cap passed as `frameSpanPct` (`sessionSpanPct`) is derived from
`rowAwareSpanPct`/strike spacing via `withCandleFloor`, NOT from the candle range itself. On a
session volatile enough that its real high-low range exceeds `SESSION_OVERVIEW_MAX_SPAN_PCT`
(2.1% of spot) — an entirely ordinary SPX/SPY move on a volatile day — `mustInclude`'s span can
legitimately exceed `maxSpan`, triggering the cascade above and clipping part of the real candle
wicks off the visible price axis.

### Evidence

Added a regression test reproducing the minimal case
(`spot=100`, `maxSpanPct=0.1`, `mustInclude={minValue:90,maxValue:108}`):
asserted `out.minValue <= mustInclude.minValue` and `out.maxValue >= mustInclude.maxValue`.

- **Before the fix:** test failed — `out.minValue` was `98`, above `mustInclude.minValue` (90).
- **After the fix:** test passes — `out = {minValue: 90, maxValue: 108}` (the honest fallback: a
  window wider than the nominal cap, since the real data cannot fit inside it).

`npx tsx --experimental-test-module-mocks --test src/features/vector/lib/vector-price-range.test.ts`:
25/25 pass post-fix (24/25 pre-fix, with the new test as the one failure). The existing sibling
test (`"clampPriceRangeSpan: squashed SPX session overview reframes around spot"`, where
`mustInclude`'s span already fits inside the cap) still passes unchanged — the fix is a no-op in
that ordinary case.

Also ran `src/features/vector/components/vector-chart-viewport.test.ts` (57/57 pass) since it
asserts on `clampPriceRangeSpan` being wired into `VectorChart.tsx`'s render path.

### Blast radius

Single call site: `VectorChart.tsx`'s session-overview price-axis framing
(`priceRange = clampPriceRangeSpan(priceRange, spotRef.current, frameSpanPct, res.priceRange)`).
No other caller in the repo. The fix only widens the returned window in the specific case where
it previously clipped real data — it never narrows a window that was already correct, so every
other `clampPriceRangeSpan` consumer path (including the existing, passing test with a
within-cap `mustInclude`) is unaffected.

### Fix rationale

Union the two sequential fixups' result with `mustInclude` as an explicit floor/ceiling
(`min = Math.min(min, mustInclude.minValue); max = Math.max(max, mustInclude.maxValue);`) rather
than trusting the two one-sided adjustments to have already covered it. This is a no-op whenever
`mustInclude` fits inside `[min, max]` after the two fixups (the ordinary case, where the
existing behavior and test are preserved exactly), and only takes effect when `mustInclude`'s own
span exceeds `maxSpan` — in which case it is structurally impossible to fit the full real range
inside the nominal cap, and showing the full real candle range (a window wider than the cap) is
strictly more honest than silently clipping part of it out of view. An alternative (e.g.
re-centering the window on `mustInclude` instead of `spot` when this happens) was considered and
rejected: it would still have to choose which edge to prioritize when `mustInclude` itself cannot
fit, whereas the union keeps the one invariant the function's own doc comment already promises —
"keeping the candle range visible" — unconditionally true for both edges, which is the simplest
fix that fully restores the stated contract.
