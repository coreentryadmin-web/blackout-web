## Vector `buildVectorContractPicks` — dead legacy shim, same pattern as a sibling already removed — FIXED

> **kind:** `FINDING`

| **Status** | Fixed in PR (fix/vector-dead-contract-picks-shim) |
|---|---|

**Symptom:** none live — pure dead code found during a routine DISCOVERY-lane sweep, not a
production defect.

**Root cause:** `buildVectorContractPicks` (`vector-contract-picks.ts`), doc-commented "Legacy
shim: bias-only input → ranked picks with synthetic play shell," built a synthetic
`VectorPlayPickContext` from a bare bias/conviction and delegated to the real ranker,
`rankVectorPlayCandidates`. The real entry point, `buildRankedVectorPicks` (same file), is the one
with actual callers. `legsForBias` — a different export in this same file, same "legacy shim"
shape — was already removed 2026-09-06 for the identical reason (FINDINGS.md "Dead code: 9 Vector
desk exports"); this one was missed in that pass.

**Evidence:** `grep -rn "\bbuildVectorContractPicks\b" --include=*.ts --include=*.tsx src scripts`
→ only the definition and its own 2 direct unit tests, before the fix.

**Fix:** Removed `buildVectorContractPicks` — it was the last export in the file after the type
definitions, so nothing else needed reordering. Removed its now-unused `VectorPlayBias`/
`VectorDteHorizon` type imports (both were only referenced by this function's signature) and its 2
direct tests from `vector-contract-picks.test.ts`. Updated the file's own header comment (which
described itself as "public types + legacy entry for callers that only have bias/conviction") to
drop the now-false "legacy entry" claim.

**Fix rationale:** Pure deletion — `buildRankedVectorPicks` is the real, actively-called entry
point into the same ranker; there was no live caller to redirect.

**Blast radius:** `src/features/vector/lib/vector-contract-picks.ts`,
`src/features/vector/lib/vector-contract-picks.test.ts` only.

**Regression guard:** `vector-contract-picks.test.ts` 2/2 pass (Node 20,
`--experimental-test-module-mocks`). `tsc --noEmit` clean.
