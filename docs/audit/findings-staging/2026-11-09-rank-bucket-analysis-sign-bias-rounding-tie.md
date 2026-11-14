> **kind:** FINDING

## rank-bucket-analysis.ts / rank-bucket-analysis-extended.ts: mean/median rounding had sign-bias at 2dp ties — FIXED

| | |
|---|---|
| **Area** | Night Hawk Legacy rank-bucket forward-performance diagnostic (`src/features/nighthawk/lib/rank-bucket-analysis.ts`, `rank-bucket-analysis-extended.ts`) |
| **Status** | FIXED |
| **Severity** | P3 — diagnostic/analysis-layer rounding, no trading decision affected |

### Root cause

`mean()`/`median()` in both modules used plain `Math.round(n * 100) / 100`, which ties toward
`+Infinity` (`Math.round(-12.5) === -12` but `Math.round(12.5) === 13`). Every `mean_*_pct`/
`median_*_pct` field these modules export (`mean_eod_pct`, `mean_mfe_pct`, `mean_mae_pct`,
`median_h1_pct`, `median_eod_pct`, confidence-interval `low`/`high` bounds, ...) is a
sign-aligned read that is genuinely negative on an adverse bucket (a losing bucket's
`mean_eod_pct`, `mean_mae_pct`, a CI bound straddling zero) — so a value sitting exactly on a
2dp rounding boundary rounded to a SMALLER magnitude than the identical positive magnitude
would, a direction-biased asymmetry.

Same bug class already fixed across ~24 sibling call sites repo-wide this session (`fmt-money.ts`'s
`fmtPct`, `round-floats.ts`, `debrief.ts`'s `round2`, `swing/record.ts`'s `round2`,
`zerodte`'s `computeLedgerGrade`, `swing` lane-rank's `deltaFromMedian`, sector-leadership
delta, industry-read rounding tie, watch-lane delta sign passthrough, among others) — this
fix mirrors every prior sibling fix exactly.

### Fix

Added `roundSignSafe2(n) = Math.sign(n) * Math.round(Math.abs(n) * 100) / 100` in both
modules and routed `mean()`/`median()` through it. In the extended module, the local `round2()`
helper is also genuinely signed (`confidenceIntervalForMean`'s `low`/`high` bounds), so it now
delegates to the same helper — `mfe_mae_ratio`'s own `round2()` use stays correct either way
since it rounds an already-nonnegative ratio, so this is a pure superset with no caller change
needed.

### Evidence

New regression test reproduces a symmetric +/- 2dp tie (a single row read favorably at
±0.125% EOD, both of which land on the hundredths-place tie boundary): pre-fix, the losing
bucket's `mean_eod_pct` rounded to `-0.12` while the winning bucket's rounded to `+0.13` —
different magnitudes for an identical absolute move. RED→GREEN confirmed via `git stash`
isolating the source change — 1/25 tests fail pre-fix (the new test), restored: 25/25 in
`rank-bucket-analysis.test.ts` + 21/21 in `rank-bucket-analysis-extended.test.ts` (46/46
total). `npx tsc --noEmit` clean, Node 20.

### Blast radius

Two files, each with its own independent `mean()`/`median()`/`round2()` copy (the extended
module deliberately keeps its own copy per its file header, so this needed two independent
fixes, not one shared import). No other call site of either function exists outside these two
modules.
