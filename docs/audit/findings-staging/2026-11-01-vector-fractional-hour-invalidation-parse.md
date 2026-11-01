> **kind:** FINDING

## Vector contract-pick invalidation misparses fractional-hour timeframe labels ("1.5H" read as 5 hours) — FIXED

**Area:** `src/features/vector/lib/vector-pick-invalidation.ts` (`parseInvalidationTimeframeMinutes`), consumed by `resolveInvalidationSpot` / `lastClosedTimeframeBarClose`, which drive live `setup_invalidated` decisions for Vector contract picks (`src/features/vector/lib/vector-pick-live-status.ts`, `src/app/api/market/vector/contract-picks/live/route.ts`, `src/lib/vector/vector-pick-sweep.ts`).

### Root cause
`parseInvalidationTimeframeMinutes` extracted the hour component of an invalidation string
(e.g. `"1H close > 7600"`) with the regex `/(\d+)\s*h\b/i`. `\d+` cannot span a decimal point, so
on a **fractional**-hour label the match restarts scanning right after the `.` instead of failing
or capturing the whole number:

```
"1.5H close < 363.47".match(/(\d+)\s*h\b/i)  // => "5H", captured group "5"  (should be 90 minutes)
"2.5H close > 100".match(/(\d+)\s*h\b/i)     // => "5H" => 5*60=300          (should be 150 minutes)
"3.3H close > 7600".match(/(\d+)\s*h\b/i)    // => "3H" => 3*60=180         (should be 198 minutes)
```

Fractional-hour labels are not a hypothetical input: `tfLabel()` in
`src/features/vector/lib/vector-play-engine.ts` renders `"1.5H"`/`"2.5H"`/`"3.3H"`-style labels for
any **custom** Vector chart interval that is not an exact multiple of 60 minutes
(`h.toFixed(1)` when `!Number.isInteger(h)`, line ~168). Vector's candle-interval picker
(`VectorTimeframeSelect.tsx`) accepts any whole-minute custom interval from `VECTOR_INTERVAL_MIN`
(1) to `VECTOR_INTERVAL_MAX` (240) via `normalizeVectorIntervalMinutes`, so a member choosing a
90-, 100-, 150- or 200-minute candle gets exactly this label shape on every play built at that
timeframe.

### Blast radius
`play.invalidation` (the string this bug mis-parses) is read directly by:
- `src/app/api/market/vector/contract-picks/live/route.ts` — the live contract-pick status route a
  member's open UI polls.
- `src/lib/vector/vector-pick-sweep.ts` — the server-side sweep that re-evaluates open picks.

Both feed it into `resolveInvalidationSpot` → `parseInvalidationTimeframeMinutes` →
`lastClosedTimeframeBarClose`, so the mis-parsed window directly changes which 1m bar's close is
treated as "the last closed bar" for the invalidation check — e.g. a 90-minute-timeframe pick would
have its invalidation evaluated against a 5-HOUR bucket instead of the real 1.5-hour one. This is
the exact same failure class this file's own header already documents fixing once (119 false
`setup_invalidated` closures, 2026-09-01) — a wrong bar-aggregation window silently flips the
invalidation verdict, either firing a false close on a still-good pick or missing a real one.

### Evidence
Added `parseInvalidationTimeframeMinutes("1.5H close < 363.47")` /
`("2.5H close > 100")` / `("3.3H close > 7600")` assertions to
`src/features/vector/lib/vector-pick-invalidation.test.ts`.
- **RED** (pre-fix): `300 !== 90` (first assertion failed; same shape for the other two).
- **GREEN** (post-fix): all three resolve to the correct minute counts (90 / 150 / 198).

### Fix rationale
Widened the hour regex to `/(\d+(?:\.\d+)?)\s*h\b/i` so the decimal portion is captured as part of
the number instead of being skipped over, then convert with `Math.round(n * 60)` (fractional hours
times 60 can land on a non-integer minute count for some values; rounding to the nearest minute is
the honest behavior rather than truncating). The integer-hour and minute-label paths are
byte-identical to before — this only changes the fractional-hour branch, which previously had no
coverage at all. No other call site needed changes: `lastClosedTimeframeBarClose` already accepts
any positive `timeframeMin`.

| **Status** | FIXED — regression test added (RED→GREEN), `tsc --noEmit` clean. |
|---|---|
