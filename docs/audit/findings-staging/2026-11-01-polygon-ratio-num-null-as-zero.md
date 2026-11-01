> **kind:** FINDING

## `ratioNum` (polygon.ts) coerced a genuinely-absent fundamental ratio to the number zero — FIXED

| | |
|---|---|
| **Area** | `src/lib/providers/polygon.ts` — `fetchPolygonFinancialRatios` (real-time valuation/leverage/liquidity ratios), consumed by Night Hawk's fundamental scorer, the SPX/NDX/RUT heatmap dividend-yield resolver, and the BIE ticker-fundamentals tool |
| **Status** | FIXED (this PR) |
| **Files** | `src/lib/providers/polygon.ts`, new `src/lib/providers/polygon-ratio-num-null.test.ts` |

### Root cause

`ratioNum`, the shared coercion helper backing EVERY field `fetchPolygonFinancialRatios` returns
(`pe_ratio`, `roe`, `debt_to_equity`, `current_ratio`, `price_to_sales`, `dividend_yield`, `price`,
etc.), was:

```ts
function ratioNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
```

`Number(null) === 0` — and `0` IS finite, so `Number.isFinite(n)` happily accepts it. Only
`Number(undefined) === NaN` was ever caught by the finiteness check. Polygon's ratios-snapshot
endpoint documents explicit JSON `null` as its convention for "not computable for this ticker" —
a loss-making company's P/E, a non-dividend-payer's yield, a debt-free company's debt/equity, a
ticker with no current-liabilities data for its current ratio. Every one of those real, honest
absences silently became the NUMBER ZERO instead of staying `null` — the exact
measured-zero-conflated-with-absence failure shape this repo's own CLAUDE.md names under "Data-
correctness notes learned" (and the same class of bug already fixed once in this file for
`computeMarketBreadthFromSummary`'s volume rounding and `market/regime`'s `numericOrNull`).

This was demonstrably the ONE HOLDOUT in this exact file: every sibling "parse an unknown field to
number-or-null" helper already guards the identical case.
`shapeBenzingaStructuredEarnings`/`shapeBenzingaCorporateGuidance`'s shared `num()` closure:

```ts
const num = (k: string) => {
  const v = row[k];
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
};
```

and `latestIndicator` (backing `fetchTickerEma`/`fetchTickerRsi`):

```ts
return v != null ? Number(v) : null;
```

Both explicitly check `v != null` BEFORE coercing. `ratioNum` was written without that guard,
seven lines below `latestIndicator` in the same file.

### Evidence

New test `src/lib/providers/polygon-ratio-num-null.test.ts`. RED→GREEN verified locally
(`git stash`/`git stash pop` around the one-line guard):

- **Before the fix**: `ratioNum(null)` → `0` (test fails: `assert.equal(ratioNum(null), null)`).
- **After the fix**: `ratioNum(null)` → `null` (passes), while `ratioNum(0)` still correctly
  returns `0` (a genuine zero ratio is never mistaken for the absence case),
  `ratioNum(undefined)`/`ratioNum("garbage")`/`ratioNum({})` still correctly return `null`, and
  `ratioNum(24.5)`/`ratioNum("13.2")` still pass real values through unchanged.

Full `src/lib/providers/polygon*.test.ts` suite: 168/168 pass after the fix (no regression).
`tsc --noEmit`: clean.

### Blast radius

`fetchPolygonFinancialRatios` is the only caller of `ratioNum` (grep-confirmed), but it feeds
every one of `PolygonFinancialRatios`'s 18 numeric fields, and has three real downstream
consumers:

- **Night Hawk's `passesFundamentalSanity`** (`src/features/nighthawk/lib/scorer.ts`) reads
  `ratios.current_ratio` as `const cr = ratios.current_ratio; if (cr != null && cr < 1) reasons
  .push(...)`. A ticker whose current_ratio was genuinely absent from the API (now `null`, so the
  `cr != null` guard correctly skips it) was previously misread as `cr = 0`, which passed the
  `cr != null` check and the `cr < 1` check, producing a FALSE "current ratio 0.00 (<1,
  working-capital squeeze)" sanity flag — a real soft demotion in Night Hawk's ranking driven
  entirely by this coercion bug, not by an actual liquidity problem. (Scorer/dossier files
  themselves are untouched by this fix — only the shared provider helper changed.)
- **The SPX/NDX/RUT heatmap's dividend-yield resolver**
  (`src/lib/providers/polygon-options-gex.ts`) reads `ratios?.dividend_yield`.
- **BIE's ticker-fundamentals tool** (`src/lib/bie/ticker-fundamentals.ts`) surfaces the whole
  ratios object to Largo.

None of those three consumer files were modified — the fix is entirely contained to the one
shared coercion helper in `polygon.ts`, so every consumer benefits without any of their own logic
changing.

### Fix rationale

Add the exact `v == null` guard every sibling helper in this file already uses, before the
`Number()` coercion — the smallest possible change that closes the gap without touching the
function's existing (correct) handling of `undefined`, `NaN`-producing garbage, or genuine
numeric strings/zeros. Exported `ratioNum` (previously module-private) so it has a direct,
focused unit test instead of only being exercisable through a full HTTP-mocked
`fetchPolygonFinancialRatios` round trip.
