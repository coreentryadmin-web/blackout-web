> **kind:** FINDING

## Swing play-brief `narrateWall` carried an unused `spot` parameter — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P5 — dead code, zero behavioral impact |
| **File** | `src/lib/swing/play-brief-narrative.ts` (`narrateWall`) |
| **Found by** | Workflow-based "dead-wired data" hunt, Ask Largo × Night Hawk Swings standing ownership mandate, 2026-10-15 |

### Root cause

`narrateWall(level, play, spot)` took a `spot: number` parameter like its siblings
(`narrateDarkPool`, `narrateMaxPain`, `narrateFlip` — which all genuinely compare against `spot`),
but every branch inside `narrateWall` reads only `level.distancePct`/`level.price` (the signed
distance already computed from spot elsewhere) — `spot` itself was never referenced in the function
body. No `tsconfig.json` `noUnusedParameters` flag catches this at build time, so it survived
silently. Most likely leftover from the 2026-10-14 BUG FIX documented in the same function, which
rewrote the `breached` logic to use `distancePct`'s sign instead of a fresh spot comparison — a
plausible mechanism for how the parameter stopped being read while the signature itself was left
unchanged.

### Fix

Removed the unused parameter from the function signature and both call sites. No behavioral change —
verified by the full existing `play-brief-narrative.test.ts` suite (123 tests) passing unchanged,
which is the correct evidence for a pure dead-code removal (there is no observable difference to
write a new RED→GREEN test against, since nothing changed).

### Blast radius

`narrateWall` is not exported — internal to `play-brief-narrative.ts`, called only from its own
`tradeManagerNarrativeSection`. Both call sites updated in the same commit.
