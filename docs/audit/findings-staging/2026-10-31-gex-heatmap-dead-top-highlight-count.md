> **kind:** FINDING

## `HEATMAP_TOP_HIGHLIGHT_COUNT` in `gex-heatmap-display.ts` was dead-exported scaffolding — never read by any ranking logic — FIXED

| | |
|---|---|
| **Area** | Shared desk infra — `src/lib/gex-heatmap-display.ts` (Thermal + SPX Slayer matrix cell styling, imported by `GexHeatmap.tsx` / `ThermalCompactMatrix.tsx`) |
| **Status** | FIXED (removed) |
| **Severity** | P4 (dead code / orphaned scaffolding — no behavioral impact, but a drift trap if ever reintroduced unwired) |

### Root cause

`src/lib/gex-heatmap-display.ts` exported:

```ts
/** Top-N ranked cells per expiry column get color; everything else stays neutral. */
export const HEATMAP_TOP_HIGHLIGHT_COUNT = 3;
```

This constant was never imported or referenced anywhere else in the repo — not by its own
file's `heatmapTopRankCellStyle` / `resolveHeatmapTopHighlightCellStyle` / `isHeatmapTopHighlightRank`
(all of which take `posRank`/`negRank` as plain numbers computed upstream), not by any component,
not by any test. A repo-wide grep against `origin/main` before the fix returned exactly one hit —
its own definition line:

```
$ grep -rn "HEATMAP_TOP_HIGHLIGHT_COUNT" --include="*.ts" --include="*.tsx" .
./src/lib/gex-heatmap-display.ts:93:export const HEATMAP_TOP_HIGHLIGHT_COUNT = 3;
```

The actual top-N ranking it was presumably meant to parameterize lives one layer up, in
`src/features/thermal/lib/thermal-compact-matrix.ts`:

```ts
export const COMPACT_TOP_HIGHLIGHT_COUNT = 3;
...
function buildHighlightMap(..., topN: number = COMPACT_TOP_HIGHLIGHT_COUNT) {
  ...
  topPositive: rankTopStrikes(cells, strikes, e, "positive", topN),
  topNegative: rankTopStrikes(cells, strikes, e, "negative", topN),
}
```

`rankTopStrikes` is what actually assigns the `posRank`/`negRank` numbers that
`GexHeatmap.tsx` and `ThermalCompactMatrix.tsx` pass into `resolveHeatmapTopHighlightCellStyle` /
`isHeatmapTopHighlightRank`. The real ranking count is `COMPACT_TOP_HIGHLIGHT_COUNT` (also `3`
today, so the two constants happen to agree — but nothing in the code keeps them in sync); the
sibling constant in `gex-heatmap-display.ts` was pure unread scaffolding from whenever that shared
display module was split out, never wired to the ranking computation that actually determines "top
N" at any call site.

### Evidence

- Repo-wide grep against `origin/main` (commit `3bd4cbfa3`) found the constant referenced nowhere
  but its own declaration (above).
- Traced every consumer of `resolveHeatmapTopHighlightCellStyle` / `isHeatmapTopHighlightRank`
  (`GexHeatmap.tsx:3973-4020`, `ThermalCompactMatrix.tsx:283-284`) back to the `posRank`/`negRank`
  fields on `hl.topPositive`/`hl.topNegative`, which are populated by
  `thermal-compact-matrix.ts`'s `buildHighlightMap` using its own, separately-defined
  `COMPACT_TOP_HIGHLIGHT_COUNT` — confirming the removed constant had no path into the actual
  ranking.
- `npx tsc --noEmit` and `npx eslint` clean on the touched files after removal; no other file
  references the symbol, so removal cannot have broken a build.

### Blast radius

None — zero consumers. No other file imports `HEATMAP_TOP_HIGHLIGHT_COUNT`, so there is no second
call site sharing this root cause to fix.

### Fix rationale

Deleted the dead export outright rather than "wiring it in" to replace
`COMPACT_TOP_HIGHLIGHT_COUNT`, because:
1. The real, live ranking count (`COMPACT_TOP_HIGHLIGHT_COUNT`) already has its own test coverage
   in `thermal-compact-matrix.test.ts` and is correctly threaded through `rankTopStrikes` — nothing
   there is broken or needs the display-layer constant.
2. Having two independently-defined "top-N" constants across two files, only one of which is ever
   read, is itself the drift risk — collapsing to one keeps a future rank-count change from being
   applied to the live constant while a second, unread one silently goes stale.
3. Added a regression test (`gex-heatmap-display.test.ts`, "does not export a dead top-N
   ranking-count constant") asserting the module no longer exports this symbol, with an in-test
   comment pointing at `thermal-compact-matrix.ts`'s `COMPACT_TOP_HIGHLIGHT_COUNT` as where a real
   ranking-count change belongs — so a future contributor who wants to parameterize this file's
   styling by rank count is pointed at wiring it from the real source, not reintroducing an
   orphaned local copy.

### Verification

- RED→GREEN proof via `git stash` on the source file alone: with only the test added and the
  source change stashed, the new test fails (`true !== false`, since the export still existed);
  restoring the source change (removal) makes it pass. Full stash/pop cycle run, not simulated.
- `npx tsx --experimental-test-module-mocks --test src/lib/gex-heatmap-display.test.ts
  src/features/thermal/lib/thermal-compact-matrix.test.ts
  src/features/thermal/components/GexHeatmap-matrix-freshness.test.ts
  src/features/thermal/components/GexHeatmap-header-change-pct.test.ts` — 37/37 pass, 0 fail.
- `npx tsc --noEmit` clean; `npx eslint` clean on both touched files.
- Re-verified zero references against a freshly-fetched `origin/main` immediately before writing
  this finding (commit `3bd4cbfa3`, unchanged from the trace above).
