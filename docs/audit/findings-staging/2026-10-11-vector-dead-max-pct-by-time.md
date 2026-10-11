## Vector `maxPctByTime` — leftover from an already-reverted contrast design — FIXED

> **kind:** `FINDING`

| **Status** | Fixed in PR (fix/vector-dead-max-pct-by-time) |
|---|---|

**Symptom:** none live — pure dead code found during a routine DISCOVERY-lane sweep, not a
production defect.

**Root cause:** `maxPctByTime` (`vector-wall-rail-core.ts`) computed the strongest wall reading AT
EACH BUCKET, shipped 2026-08-18 as the fix for session-wide contrast (so a wall that dominated at
10:15 and was noise by 14:00 no longer rendered at the same brightness in both). Its only caller
was `WallRailPaneView.project()`'s `_derivedCache` in `vector-wall-rail-primitive.ts`, which cached
a `maxPctAtTime` value from it. The very next day (2026-08-19, per that file's own inline comments)
the colour-contrast approach was reverted back to a per-SIDE book-peak denominator
(`sidePctMaxima`/`sideMaxPct`) because the per-bucket version "flattened" colour signal — every row
became the bucket king at some point in the session, painting at full brightness regardless of real
strength. The per-bucket map's only caller was then explicitly deleted 2026-08-27 as CodeQL-flagged
dead code ("nothing has read the per-bucket map since" — confirmed in `project()`'s current
`_derivedCache` destructure, which only carries `earliest, callKingAt, putKingAt, liveTime`, no
`maxPctAtTime`). The leftover export in `vector-wall-rail-core.ts` was simply never cleaned up in
that same pass.

**Evidence:** `grep -rn "\bmaxPctByTime\b" --include=*.ts --include=*.tsx src scripts` → only the
definition and its own 3 direct unit tests, before the fix. `vector-wall-rail-primitive.ts`'s
`project()` no longer references it at all.

**Fix:** Removed `maxPctByTime` and its doc comment from `vector-wall-rail-core.ts`. Removed the 3
tests exercising it directly from `vector-wall-rail-core.test.ts` and its now-unused import,
replacing the stale "POINT-IN-TIME CONTRAST (2026-08-18)" section header with one that accurately
describes the current size-vs-contrast channel split and notes the per-bucket design's supersession
— the one surviving test in that section (`SIZE stays absolute while CONTRAST goes relative`)
exercises the still-live `targetHalfPx`/`fillAlpha` behavior directly, not the removed function, so
it is untouched.

**Fix rationale:** Pure deletion — this is a low-severity leftover from an already-resolved,
already-documented design revert (FINDINGS.md 2026-08-18/08-19/08-27), not a new defect.

**Blast radius:** `src/features/vector/lib/vector-wall-rail-core.ts`,
`src/features/vector/lib/vector-wall-rail-core.test.ts` only.

**Regression guard:** `vector-wall-rail-core.test.ts` 68/68 pass (Node 20,
`--experimental-test-module-mocks`). `tsc --noEmit` clean.
