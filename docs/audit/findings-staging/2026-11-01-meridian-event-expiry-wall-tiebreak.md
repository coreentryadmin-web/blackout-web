> **kind:** FINDING

## Meridian event-expiry call/put wall picked a non-deterministic strike on an exact tie (decimal strike keys)

| | |
|---|---|
| **Area** | Meridian — event-scoped dealer structure (`scopeStructureToExpiry`, earnings/event panels) |
| **Severity** | P3 — correctness/determinism, narrow trigger (exact-value tie), decimal-strike chains only |
| **Status** | Fixed |

### Root cause

`scopeStructureToExpiry` (`src/lib/meridian/meridian-event-expiry-core.ts`) re-derives the
event-scoped call wall (largest positive net dealer gamma) and put wall (largest negative) by
running a running-argmax/argmin scan straight over `Object.entries(input.cells ?? {})`, with no
sort before the scan:

```ts
for (const [strikeKey, byExpiry] of Object.entries(input.cells ?? {})) {
  ...
  if (v > 0 && (!constrained || strike > spot!) && (best == null || v > best.v)) {
    best = { strike, v };
  }
  ...
}
```

On an **exact tie** between two strikes' gamma, the comparison `v > best.v` is false for the
later-encountered strike, so whichever strike `Object.entries()` happens to enumerate **first**
wins — and for a `Record<string, number>` whose keys are **decimal** strings (e.g. `"92.5"`,
the normal case for a 0.5-wide options chain on a lower-priced underlying), JS enumerates in
**insertion order**, not numeric order. Two payloads describing the exact same book, differing
only in which strike's column happened to land in `cells` first, can therefore report a
*different* call/put wall for the same tie.

This is the exact defect class — and exact fix — already applied to the sibling function
`kingFromStrikeTotals` in `gex-cross-validation-core.ts` (sort `Object.entries()` ascending by
numeric strike before the argmax scan, so an exact tie deterministically keeps the LOWER strike
on every call, regardless of insertion order). `scopeStructureToExpiry`'s own header comment
already documents that it "independently reimplements the same wall selection" as
`wallsFromStrikeTotals` and "never inherited" an earlier side-of-spot fix for that reason — the
same independent-reimplementation gap left this tie-break defect unfixed here too, since the
`kingFromStrikeTotals` fix never propagated to this file.

Integer-like strike keys ("90", "100") are unaffected in practice — the JS spec guarantees
ascending numeric enumeration for array-index-like string keys regardless of insertion order —
which is exactly why this was easy to miss in a codebase where many test fixtures and liquid
index names (SPX, SPY) use whole-dollar strikes. The bug only surfaces for decimal-strike
chains (e.g. lower-priced single names with $0.50/$2.50-wide options), consistent with
`kingFromStrikeTotals`'s own comment calling out "`450.5` — the normal case for SPX's 0.5-wide
chain" as the trigger shape for this exact class of bug.

### Evidence (RED → GREEN)

Added two tests building the identical tied book (two decimal strikes with exactly equal
positive, then exactly equal negative, net gamma) in two different `cells` key insertion
orders:

```ts
const ascendingInsertion = {
  "92.5": { "2026-08-21": 5_000_000 },
  "97.5": { "2026-08-21": 5_000_000 },
};
const descendingInsertion = {
  "97.5": { "2026-08-21": 5_000_000 },
  "92.5": { "2026-08-21": 5_000_000 },
};
```

**Pre-fix (RED):** `scopeStructureToExpiry({ cells: ascendingInsertion, ... }).callWall === 92.5`
but `scopeStructureToExpiry({ cells: descendingInsertion, ... }).callWall === 97.5` — same book,
different answer. 2 new tests failed (`npx tsx --experimental-test-module-mocks --test
src/lib/meridian/meridian-event-expiry-core.test.ts`, verified via `git stash` on just the
source file to isolate the pre-fix behavior): `25 pass / 2 fail`.

**Post-fix (GREEN):** both orderings now deterministically return `callWall === 92.5` /
`putWall === 92.5` (lower strike wins the tie, matching `kingFromStrikeTotals`'s convention).
Full file: `27 pass / 0 fail`. Full `src/lib/meridian/**/*.test.ts` suite (23 files): `511 pass /
0 fail`. `tsc --noEmit` clean.

### Blast radius

`scopeStructureToExpiry` has exactly two call sites, both of which inherit the fix automatically
with no changes needed: `meridian-earnings-intel.ts` and `meridian-thermal-scope.ts` (both read
the function's `callWall`/`putWall` output, neither reimplements the scan). No other function in
this file, or in the Meridian module generally, reimplements this argmax/argmin-over-cells
pattern — grepped `Object.entries(` across `src/lib/meridian/` and inspected every hit; the only
other running-max/min scans in that directory already sort first (e.g.
`per-expiry-levels.ts`'s accumulate-then-sort, `theta-distribution.ts`'s sort-before-rank).

### Fix rationale

Sort `Object.entries(input.cells ?? {})` ascending by numeric strike before the scan — identical
pattern, identical tie-break convention (lower strike wins), as the already-fixed
`kingFromStrikeTotals` in `gex-cross-validation-core.ts`, so the two independent wall-selection
implementations in this codebase now agree on tie-break behavior instead of drifting. Left the
side-of-spot constraint, null-on-no-candidate behavior, and every other branch of the function
untouched — this fix is scoped purely to iteration order ahead of the comparison, not to the
comparison or gating logic itself.
