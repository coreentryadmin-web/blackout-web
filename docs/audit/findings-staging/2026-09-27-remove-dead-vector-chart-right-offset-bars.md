## Dead-code: `vectorChartRightOffsetBars`/`VECTOR_VP_RIGHT_OFFSET_BARS` deprecated pure-passthrough pair had zero remaining callers — REMOVED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Vector — chart layout (volume-profile gutter), dead-code hygiene |
| **Severity** | P4 (dead code, no behavior change, no runtime impact) |
| **Status** | FIXED |
| **Files** | `src/features/vector/lib/vector-volume-profile-layout.ts` |

### Root cause

`src/features/vector/lib/vector-volume-profile-layout.ts` carried a `@deprecated` bar-count
constant and the pure-passthrough function reading it:

```ts
/** @deprecated Prefer `vectorChartTimeScaleGutter` — bar offset alone is too narrow on phone embeds. */
export const VECTOR_VP_RIGHT_OFFSET_BARS = 18;
...
/** @deprecated Use vectorChartTimeScaleGutter */
export function vectorChartRightOffsetBars(volumeProfileEnabled: boolean): number {
  return volumeProfileEnabled ? VECTOR_VP_RIGHT_OFFSET_BARS : VECTOR_BASE_RIGHT_OFFSET_BARS;
}
```

A repo-wide grep for both names (`grep -rn` across `src`, excluding `node_modules`/`.next`) found
zero real call sites — `vectorChartRightOffsetBars(` matched only its own definition, and the two
hits in `VectorChart.tsx` are comment prose referencing the name, not calls. `VECTOR_VP_RIGHT_OFFSET_BARS`
is read nowhere except inside the now-removed function itself. The canonical replacement,
`vectorChartTimeScaleGutter` (same file), remains in active use and unaffected. Same dead
pure-passthrough-alias shape as `isEtMarketHours` (PR #5484) and `xPostFooter` (PR #5504).

Last real edit to this file was PR #2929 (2026-08-26) — well outside any lane's current work this
cycle.

### Evidence

```
$ grep -rn "vectorChartRightOffsetBars(" --include="*.ts" --include="*.tsx" . --exclude-dir=node_modules --exclude-dir=.next
./src/features/vector/lib/vector-volume-profile-layout.ts:50:export function vectorChartRightOffsetBars(volumeProfileEnabled: boolean): number {
```

Only its own definition — no importer, no test coverage across the three test files that exercise
this module (`vector-volume-profile-layout.test.ts`, `vector-volume-profile-primitive.test.ts`,
`vector-chart-viewport.test.ts` — none reference either name).

### Fix

Deleted the 4-line dead function and the now-unused constant. `tsc --noEmit` clean;
`eslint src/features/vector/lib/vector-volume-profile-layout.ts` clean; the three collateral test
files (63 tests total) pass unchanged. No new test needed: the removed code had zero test coverage
to begin with (pure deletion of unreachable code).

### Blast radius

None — neither symbol had any external caller, so no other file needed updating.
