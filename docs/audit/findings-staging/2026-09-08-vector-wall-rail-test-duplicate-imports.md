> **kind:** `FINDING`

## `vector-wall-rail-core.test.ts` had 4 duplicate named imports — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Vector bead-rail test suite (`src/features/vector/lib/vector-wall-rail-core.test.ts`) |
| **PR** | (pending — `fix/dedupe-vector-wall-rail-test-imports`) |

### Symptom

Found while checking a file-change notification on `main` during a routine coordinator cycle
(this file has a long history of parallel edits across many small Vector-lane PRs). The single
import statement from `./vector-wall-rail-core` listed four identifiers twice each:
`MIN_CLAMPED_HALF_RANGE_PX`, `beadRenderTuning`, `targetHalfPx`, `rowSwellMul` — each appeared
once early in the block and again later, evidently from two separate PRs each adding an import
for the same symbol without noticing the other had already added it.

### Why this shipped silently

Two independent reasons this never surfaced in CI:
1. `tsconfig.json`'s `exclude` list carries `**/*.test.ts` — test files are never passed to
   `tsc --noEmit`, so the project's own typecheck never sees this file at all. A minimal repro
   (`import { foo, foo } from "./x"`) confirms `tsc` normally reports `TS2300: Duplicate
   identifier` for exactly this pattern — it just never runs against test files here.
2. The actual test runner (`tsx --test`, esbuild-backed transpile-only) does not reject a
   duplicate named import at runtime either — it silently keeps one binding and the suite runs
   and passes normally (confirmed: 66/66 passed both before and after this fix).

So the duplication was invisible to every automated check in the pipeline — a real but silent
hygiene defect, not a functional bug (both bindings point at the same export, so no behavior
changed).

### Fix

Removed the four duplicate identifiers from the single `import { ... } from "./vector-wall-rail-core"`
statement, keeping one instance of each. No test logic changed.

### Blast radius

Single import statement, single file. Grepped the rest of the Vector `*.test.ts` suite for the
same duplicate-named-import pattern — none found elsewhere.

### Verify

```
export PATH=/opt/node20/bin:$PATH
npx tsx --test --experimental-test-module-mocks src/features/vector/lib/vector-wall-rail-core.test.ts
```
66/66 pass (unchanged from before the fix — this was never a functional defect).

Full Vector suite: `npx tsx --test --experimental-test-module-mocks src/features/vector/**/*.test.ts`
— 1375/1375 pass. `npx tsc --noEmit`: clean (exit 0, as before — this file was never in tsc's
scope either way).

### Note

Per `CLAUDE.md`'s self-authored-PR carve-out, this PR holds for Cursor's explicit
`✅ GO AHEAD MERGE` sign-off before merging — not self-merged.
