## Largo core — 2 dead exports: `buildOccSymbol`, `nightHawkRead` — FIXED

> **kind:** `FINDING`

| **Status** | Fixed in PR (fix/largo-core-dead-exports) |
|---|---|

**Symptom:** none live — pure dead code found during a routine DISCOVERY-lane sweep, not a
production defect.

**Root cause:**
- `buildOccSymbol` (`src/lib/largo/core/entities.ts`) builds an OCC symbol — the inverse of
  `parseOccSymbol`, which IS heavily used elsewhere in this file's real callers. Its own doc
  comment ("Round-trips with parseOccSymbol — asserted by test") describes a test-only property,
  not a production need; nothing in the repo ever constructs an OCC symbol from parts at runtime.
- `nightHawkRead` (`src/lib/largo/core/system-reads.ts`) was a simple play-count directional read
  taking a flat play list. Its sibling `nightHawkReconciledRead` (same file) — which reconciles
  evening edition, 0DTE board, swing lane, and per-ticker state across multiple products — is the
  one actually wired into `system-reads-extract.ts`; `nightHawkRead` is the superseded, simpler
  earlier version.

**Evidence:** `grep -rwn "buildOccSymbol"` and `grep -rwn "\bnightHawkRead\b"` across
`--include=*.ts --include=*.tsx src scripts` → each name appeared only in its own definition and
direct unit tests, before the fix. `system-reads-extract.ts`'s own import list confirms it pulls
`helixFlowRead, vectorPlayRead, gammaRegimeRead, nightHawkReconciledRead, agreementOf` from
`system-reads.ts` — `nightHawkRead` is the one name absent from that list.

**Fix:** Removed both functions. Removed `buildOccSymbol`'s import and its 2 direct tests from
`entities.test.ts` (the round-trip test and the refuses-invalid-input test); `sameTicker`,
`canonicalSession`, `extractTickers`, `parseOccSymbol`, `canonicalTicker`, `formatEntityBlock` all
confirmed to have real callers and are untouched. Removed `nightHawkRead`'s import and its 1 direct
test from `system-reads.test.ts`; `SystemStance` (the type it used) has other real uses in the same
file and is untouched.

**Fix rationale:** Pure deletion in both cases — no live caller to redirect, and in the Night Hawk
case the richer successor already covers the same ground.

**Blast radius:** `src/lib/largo/core/entities.ts`, `src/lib/largo/core/entities.test.ts`,
`src/lib/largo/core/system-reads.ts`, `src/lib/largo/core/system-reads.test.ts` only.

**Regression guard:** `entities.test.ts` + `system-reads.test.ts` 28/28 pass combined;
`cross-source.test.ts` + `system-reads-extract.test.ts` (both depend on these two files) 22/22 pass
(Node 20, `--experimental-test-module-mocks`). `tsc --noEmit` clean.
