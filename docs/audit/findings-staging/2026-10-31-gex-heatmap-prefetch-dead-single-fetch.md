> **kind:** FINDING

## `fetchGexHeatmapForPrefetch` — orphaned single-ticker fetch left behind by the batch-prefetch refactor — FIXED

**Area:** `src/lib/gex-heatmap-prefetch.ts` (Thermal compare-grid client-side warm-start)

### Root cause

`fetchGexHeatmapForPrefetch(ticker, signal)` was the *original* implementation of per-ticker
prefetching: `prefetchGexHeatmapTickers` used to loop over the compare-grid's tickers and call it
once per name in parallel (shipped in `b5a922c22`/`ec77185b0`, "Thermal: triple-grid prefetch...").

That per-ticker fan-out turned out to be the sync-storm bug fixed in `c0c5fce43`
("fix(thermal): compare grid batch cache-reader + 6 performance fixes") and `98640d3ad`
("fix(thermal): compare grid sync storm + SPX 504 + Largo launch/deadline"): a member scrolling
through the sector-preset dropdown could fire N parallel cold-chain builds per preset, and every
superseded preset kept running to completion and still wrote `sessionStorage` behind the member's
back. The fix replaced the per-ticker loop with a *single* batched GET
(`fetchGexHeatmapBatchForPrefetch`, calling `/api/market/gex-heatmap/batch`) plus an
abort-on-supersede `AbortController`, exactly as the current file's own `inFlight` comment
describes.

When that refactor landed, `prefetchGexHeatmapTickers` was rewritten to call the new batch
function — but the old single-ticker `fetchGexHeatmapForPrefetch` was left in the file, still
`export`ed, with nothing calling it. It has had zero callers, in this file or anywhere else in the
repo, since `c0c5fce43` landed.

### Evidence

- Repo-wide search for `fetchGexHeatmapForPrefetch` across `*.ts`/`*.tsx`/`*.mjs`/`*.cjs`/`*.md`
  (excluding `node_modules`) returns **exactly one hit**: its own `export async function`
  declaration. No import, no call site, no test reference (`gex-heatmap-prefetch.test.ts` tests
  only `prefetchGexHeatmapTickers`/`__test_resetGexHeatmapPrefetch`/the batch path — it never
  mentions the single-ticker function).
- `git log --all -S"fetchGexHeatmapForPrefetch(" -- src/lib/gex-heatmap-prefetch.ts
  src/features/thermal` shows exactly the four commits above: two that introduced it as the only
  call path, then two that replaced its only caller with the batch function, without removing the
  now-dead declaration itself.
- `git show b5a922c22:src/lib/gex-heatmap-prefetch.ts` confirms the pre-refactor shape: a `for`
  loop calling `fetchGexHeatmapForPrefetch(ticker)` per ticker — proving this was once live code
  for its intended purpose, not abandoned scaffolding that was never wired up.

### Blast radius

None beyond this one file. `fetchGexHeatmapForPrefetch` is not re-exported or re-used anywhere
else; `fetchGexHeatmapBatchForPrefetch` (the live replacement) is unaffected and untouched.

### Fix rationale

Deleted the dead function outright rather than wiring it back in: the batch approach it was
replaced by is deliberately the *fix* for a real production bug (uncontrolled parallel cold-chain
builds), so resurrecting the per-ticker path would be a regression, not an improvement. There is no
other current use case for a single-ticker prefetch (the only caller, the compare grid, always
calls with the full ticker list), so removal is the correct fix rather than wiring it to a new call
site.

No behavior change for any live code path: `prefetchGexHeatmapTickers` and
`fetchGexHeatmapBatchForPrefetch` are untouched. `tsc --noEmit`, eslint, and the existing
`gex-heatmap-prefetch.test.ts` suite (3/3 tests, unchanged) all pass clean after the removal,
confirming zero live dependents.

| **Status** | FIXED — dead export removed, zero references confirmed, existing tests pass unchanged. |
|---|---|
