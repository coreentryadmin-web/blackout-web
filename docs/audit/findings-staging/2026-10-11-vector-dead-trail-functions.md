## Vector `vector-wall-history.ts` — superseded rank/flip trail trio, all dead — FIXED

> **kind:** `FINDING`

| **Status** | Fixed in PR (fix/vector-dead-trail-functions) |
|---|---|

**Symptom:** none live — pure dead code found during a routine DISCOVERY-lane sweep, not a
production defect.

**Root cause:** `trailForRank`, `trailForFlipLevel`, and `trailForGammaFlip` (`@deprecated Use
trailForFlipLevel(history, "gex")`) all projected wall history into plain `{time, strike[, pct]}`
point arrays — an older, flatter trail shape. `VectorChart.tsx` (the real consumer of this file)
imports a different set of trail functions from the same module —
`composeHorizonTrail`/`narrowedHorizonTrail`/`beadRailHistoryForHorizon`/`trailsByStrike` — none of
which call any of these three. The strike-keyed `trailsByStrike` (same file, right after the deleted
`trailForRank`) superseded the rank-based projection specifically so a migrating wall renders as two
distinct horizontal trails instead of a diagonal rank-scatter; the flip/gamma pair was similarly
superseded by direct `flipForLens` usage in the real live-chart path (`vector-wall-events.ts`,
`vector-replay.ts`).

**Evidence:** `grep -rn "\btrailForFlipLevel\b\|\btrailForGammaFlip\b\|\btrailForRank\b"
--include=*.ts --include=*.tsx src scripts` → only the 3 definitions and their own direct unit
tests. `flipForLens` (the helper `trailForFlipLevel` wrapped) has its own separate real callers in
`vector-wall-events.ts` and `vector-replay.ts` and is untouched.

**Fix:** Removed `trailForRank`, `trailForFlipLevel`, and `trailForGammaFlip` from
`vector-wall-history.ts`. Removed their imports and 5 direct unit tests from
`vector-wall-history.test.ts` (75 remaining tests, covering `trailsByStrike`/the real trail
functions/history management, are untouched).

**Fix rationale:** Pure deletion — no other file referenced any of the three, so there was no call
site to redirect.

**Blast radius:** `src/features/vector/lib/vector-wall-history.ts`,
`src/features/vector/lib/vector-wall-history.test.ts` only.

**Regression guard:** `vector-wall-history.test.ts` 75/75 pass (Node 20,
`--experimental-test-module-mocks`). `tsc --noEmit` clean.
