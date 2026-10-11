## Vector `prepareVectorLiveHelixTape` — superseded flat tape, dead since the recent+ranked layout shipped — FIXED

> **kind:** `FINDING`

| **Status** | Fixed in PR (fix/vector-dead-helix-tape-prep) |
|---|---|

**Symptom:** none live — pure dead code found during a routine DISCOVERY-lane sweep, not a
production defect.

**Root cause:** `prepareVectorLiveHelixTape` (`vector-helix-flows.ts`) built a single flat tape —
filter, sort by premium, slice to a cap. The real caller, `VectorHelixRail.tsx`, imports and calls
`pickVectorLiveHelixLayout` (same file) instead — the newer Recent-strip + premium-ranked-list
layout, which splits the eligible pool into two independently-capped sections rather than one flat
list, while reusing the same `compareLiveHelixByPremium` sort for its ranked half.

**Evidence:** `grep -rln "prepareVectorLiveHelixTape" --include=*.tsx --include=*.ts src` → only
`vector-helix-flows.ts` (its own definition) and `vector-helix-flows.test.ts` (its own tests), never
`VectorHelixRail.tsx`, before the fix.

**Fix:** Removed `prepareVectorLiveHelixTape`. `VECTOR_LIVE_HELIX_TAPE_CAP` (the constant it
defaulted to) has other real callers (`use-vector-helix-flows.ts`, and a different function later
in the same file) and is untouched. Removed its import and 5 direct tests from
`vector-helix-flows.test.ts` — the file's `pickVectorLiveHelixLayout` tests, which exercise the
real current behavior (leader-stays-#1, recent/ranked split, display caps), are untouched.

**Fix rationale:** Pure deletion — no live caller to redirect; `pickVectorLiveHelixLayout` is the
real entry point and already has its own coverage.

**Blast radius:** `src/features/vector/lib/vector-helix-flows.ts`,
`src/features/vector/lib/vector-helix-flows.test.ts` only.

**Regression guard:** `vector-helix-flows.test.ts` 17/17 pass (Node 20,
`--experimental-test-module-mocks`). `tsc --noEmit` clean.
