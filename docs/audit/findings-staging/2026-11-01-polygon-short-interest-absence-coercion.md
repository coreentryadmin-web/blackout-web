> **kind:** FINDING

## `fetchShortInterest` coerced an absent Polygon short-interest field to zero — FIXED

**Status:** Fixed (branch `fix/short-interest-absence-coercion`).

### Root cause

`fetchShortInterest` in `src/lib/providers/polygon.ts` shaped the raw
`/stocks/v1/short-interest` row with:

```ts
short_interest: Number(row.short_interest ?? 0),
avg_daily_volume: Number(row.avg_daily_volume ?? 0),
days_to_cover: Number(row.days_to_cover ?? 0),
```

`?? 0` silently turns a field Polygon OMITS from the response into the number `0`. Polygon's
documented convention (confirmed against its own OpenAPI short-interest schema, and the same
convention this repo's sibling `ratioNum` helper already guards for the financial-ratios
endpoint) marks `short_interest`, `avg_daily_volume` and `days_to_cover` as nullable/omittable —
`days_to_cover` in particular is structurally undefined (and so dropped from the row) whenever
`avg_daily_volume` is 0 or unreported, since the ratio has no value. The old code could not tell
"this ticker genuinely has 0 days to cover" (fully liquid, no squeeze risk) from "we have no
reading at all" — both arrived as the plain number `0`, and every downstream reader that checks
`!= null` (the honest-absence idiom this codebase uses everywhere else) would treat the fabricated
zero as a real, measured value.

Every sibling "parse an unknown API field to number-or-null" helper in this same file already
guards this exact case (the `num()` closures in `shapeBenzingaStructuredEarnings`/
`shapeBenzingaCorporateGuidance`, `latestIndicator`'s `v != null ? Number(v) : null`, and the
`ratioNum` helper backing `fetchPolygonFinancialRatios`) — `fetchShortInterest` was the one
remaining short-interest/short-positioning reader still using a bare `Number(x ?? 0)`.

### Evidence

Added `src/lib/providers/polygon-short-interest-absence.test.ts`. Against the pre-fix code the new
pure functions did not exist at all (proving the coercion lived inline, untestable, inside the
network-calling function) — `git stash` on `polygon.ts` and re-running the new test file fails
every case with `shortInterestNum is not a function` / `shapeShortInterestRow is not a function`.
After restoring the fix, all 7 cases pass, including the two that matter:

- `shapeShortInterestRow`: a row with `short_interest` present but `avg_daily_volume`/
  `days_to_cover` genuinely absent now yields `avg_daily_volume: null, days_to_cover: null` (was
  `0, 0` before the fix).
- `shapeShortInterestRow`: a row with a real `days_to_cover: 0` still returns `0` — the fix does
  not over-correct and swallow a genuine zero reading either.

`npx tsc --noEmit` is clean (0 errors) across the whole project after the fix.

### Blast radius

`fetchShortInterest`'s only two consumers whose code reads the raw numeric fields directly:

- `src/lib/bie/ticker-fundamentals.ts`'s `normalizeShortInterest` — its own `finiteOrNull` helper
  already nulled out ANY `0` (including the old coerced-zero), so this consumer's *observable
  output is byte-identical* before and after the fix; only its parameter type (`number` →
  `number | null`) needed widening to keep compiling, verified via `src/lib/bie/
  ticker-fundamentals.test.ts` (all 7 cases still pass unchanged).
- `src/features/nighthawk/lib/dossier.ts` — its `short_days_to_cover` field was already typed
  `number | null`, so the fix's genuine `null` now flows straight through `shortSi?.days_to_cover
  ?? null` instead of masquerading as a measured `0` that `format.ts` would have rendered as
  `"Short days-to-cover: 0.0"`.
- `src/lib/largo/run-tool.ts`'s `get_short_interest`/`get_short_data` tools pass the object through
  untyped as JSON payload — unaffected either way.

`fetchShortVolume` (the sibling function one screen below, same `Number(x ?? 0)` shape) carries the
identical latent bug but is left untouched here to keep this PR single-issue; flagged as a
follow-up candidate for a future round.

### Fix rationale

Extracted the row-shaping into two small, pure, exported functions
(`shortInterestNum`/`shapeShortInterestRow`) rather than reaching for the already-exported
`ratioNum` helper, because `ratioNum`'s own `v != null` null-guard currently lives on an *open,
unmerged* PR (`fix/polygon-ratio-num-null`) — depending on it here would create exactly the
cross-PR merge-ordering hazard this repo's own `CLAUDE.md` warns about (a fix whose correctness
depends on a sibling PR landing first). The new helper is self-contained and intentionally mirrors
the same null-safe shape, so a future merge of that PR changes nothing here.
