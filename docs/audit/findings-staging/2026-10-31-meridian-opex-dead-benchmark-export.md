> **kind:** FINDING

## Meridian OpEx cross-market: dead `meridianOpexBenchmarkTickers` re-export (and the constant it aliased) — FIXED

**Status:** Fixed in this PR.

### Root cause

`src/lib/meridian/meridian-opex-cross-market.ts` shipped in the original OpEx
cross-market feature PR (#2255, 2026-08-16) with this line at the bottom of
the file:

```ts
/** Benchmark tickers surfaced in the cross-market panel (for tests / docs). */
export const meridianOpexBenchmarkTickers = MERIDIAN_OPEX_BENCHMARKS;
```

The comment claims it exists "for tests / docs," but no test file and no doc
ever imported it. A repo-wide grep (`grep -rn "meridianOpexBenchmarkTickers"`,
excluding `node_modules`) returns exactly one hit — its own definition. It
was dead on arrival: a re-export nobody ever consumed, not a flag-gated or
WIP symbol (verified via `git log --all -S"meridianOpexBenchmarkTickers"`,
which shows only the two commits that introduced and squash-merged the
original feature, no later wiring attempt).

Removing it exposed a second, same-root-cause dead export one file over:
`MERIDIAN_OPEX_BENCHMARKS` (`src/lib/meridian/meridian-opex-cross-market-core.ts`,
`["SPY", "QQQ", "IWM"] as const`) had exactly one importer — the dead
re-export above — and is not used anywhere else, including inside its own
defining file (unlike its sibling `MERIDIAN_OPEX_MAG7`, which core.ts's own
`buildMeridianOpexCrossMarket`/`summarizeMag7Sessions` genuinely consume, and
which `meridian-opex-cross-market.ts`'s `loadMeridianOpexCrossMarket` also
consumes for the real Mag7 fan-out). The SPY/QQQ/IWM fetches in
`loadMeridianOpexCrossMarket` already use hardcoded ticker literals directly
(`stockReactionsForDates("SPY", dates)` etc.) rather than iterating
`MERIDIAN_OPEX_BENCHMARKS` — so the constant's *value* was never even
duplicated as a literal that this removal needs to preserve; the three
tickers it names are the exact three literals already hardcoded a few lines
up in the same file.

### Evidence

- `grep -rn "meridianOpexBenchmarkTickers" .` (excluding `node_modules`):
  one hit, the definition itself.
- `grep -rn "MERIDIAN_OPEX_BENCHMARKS" src/` after removing the first export:
  one hit, the definition itself (now fully orphaned).
- `git log --all --oneline -S"meridianOpexBenchmarkTickers"`: two commits,
  both the original feature add (`c1ddf6613`, squash-merged as `d223011c3`
  / #2255) — no later consumer ever landed.
- `npx tsc --noEmit` on the full project: clean after removal (proves no
  other module imports either symbol).
- `npx eslint` on both touched files: clean.
- `npx tsx --experimental-test-module-mocks --test
  src/lib/meridian/meridian-opex-cross-market-core.test.ts`: 5/5 pass,
  unchanged (the removed constant was never exercised by this suite either).

### Blast radius

Two files, same root cause (a value computed/exported once, never consumed):
- `src/lib/meridian/meridian-opex-cross-market.ts` — removed the dead
  `meridianOpexBenchmarkTickers` export and the now-unused
  `MERIDIAN_OPEX_BENCHMARKS` import.
- `src/lib/meridian/meridian-opex-cross-market-core.ts` — removed
  `MERIDIAN_OPEX_BENCHMARKS` itself, now that its only importer is gone.

No other call site references either symbol. `MERIDIAN_OPEX_MAG7` (the
sibling constant in the same file) is untouched — it has real, live
consumers in both files and stays exactly as-is.

### Fix rationale

Deleted outright rather than wiring it up into a test/doc, because nothing
in the PR that introduced it, nor any PR since, ever needed it — the
"(for tests / docs)" comment described an intention that never
materialized, not a currently-used contract. Did not touch
`MERIDIAN_OPEX_MAG7` or any other export in either file — this fix is
scoped strictly to the one dead re-export and the constant it exclusively
aliased.

### Why it wasn't caught earlier

`export const` dead-code of this shape produces no lint warning in this
project's eslint config (unused *exports* are not flagged the way unused
*local* bindings are — only an export-aware tool like `ts-prune`/knip would
catch it, and none run in CI here), and `tsc --noEmit` has no opinion on an
export nobody imports. It is only visible to a manual cross-file grep sweep,
which is what this audit round performed.
