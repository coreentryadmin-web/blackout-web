> **kind:** FINDING

## 2026-08-25 — thesis-first G9 merge + evidence bundle + PIN positioning — FIXED

| **Status** | FIXED in PR (thesis-evidence-g9-fix) |
|------------|--------------------------------------|

**Root cause:** `buildMergedThesisFromHits` dropped opposing-direction rail hits after `resolveMergedDirection`, violating LARGO contract (disagreement must be represented). PIN setups from `buildPinSetup` never carried `gamma_regime`/walls, so POSITIONING rail could not fire. Thesis rails read only legacy setup fields, not Thermal/Vector cache snapshots.

**Fix:** `disagreeing_rails` on `MergedThesis`; rank capped WATCH on conflict; `fetchThesisEvidenceForTickers` cache-reader bundle wired in `scan.ts`; `stampPinSetupPositioning` on PIN discovery path.

**Evidence:** `src/lib/zerodte/thesis/evidence-g9.test.ts` — 21/21 thesis tests pass.
