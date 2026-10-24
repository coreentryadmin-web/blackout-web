## Vector gamma-magnet callout: whole-dollar level paired with an unrounded-strike percent — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Vector gamma magnet (`src/features/vector/lib/vector-gamma-magnet.ts`) |
| **Found by** | Ask Largo fan-out audit (8-ticker parallel workflow, adversarially verified), 2026-10-24, live repro BMNR |

### Symptom

BMNR's live swing play-brief `structureLadder` rung (`kind: "magnet"`) carried `price: 30.67`, `distancePct: 36.9`, but its own `meta` string (the `GammaMagnet.callout`) read `"gamma pivot 31 (+36.86%) — short gamma amplifies a move away, won't hold"`. The level named (31) and the percent quoted beside it (+36.86%) describe two *different* numbers: `(31-22.41)/22.41 = +38.33%`, not +36.86%; +36.86% is the real percent for the real strike, 30.67 — which is exactly what the rung's own `price`/`distancePct` fields (and the swing narrative's `fmtPriceLevel(m.strike)` line) already render correctly.

### Root cause

`deriveGammaMagnet()` computes `distancePct` from the unrounded, cents-precision `strike` (a weighted mean of call+put wall strikes — rarely near-integer), then called `buildCallout(Math.round(strike), distancePct, ...)` — passing a WHOLE-DOLLAR rounding of the level into the same sentence as a percent computed from the cents-precision one. Whenever the weighted strike wasn't already near-integer (the ordinary case), the two numbers in one sentence described different levels.

### Blast radius

`GammaMagnet.callout` is a single string consumed by `VectorChart.tsx`, `VectorPageShell.tsx`, `VectorPlayAnalyticsDrawer.tsx`, `vector-play-bootstrap.ts`, `vector-play-desk-snapshot.ts`, `vector-pulse.ts`, `src/lib/bie/vector-full-state.ts` (Largo's BIE narrative layers), and swing's `play-brief-narrative.ts` (`collectFocalLevels`, feeding the `structureLadder` rung's `meta`). All render the same self-inconsistent sentence whenever the magnet strike isn't near-integer.

### Fix

Pass the SAME cents-precision strike (`round2(strike)`, matching the already-correct `GammaMagnet.strike` field) into `buildCallout`, and format it via the shared `fmtPriceLevel()` helper (matching every narrative consumer's own formatting of `m.strike`) instead of raw number interpolation.

### Evidence

- RED→GREEN: new test reproduces the exact BMNR numbers (spot 22.41, weighted strike 30.67) via a 2-wall fixture; fails against pre-fix source (`git stash`), passes after.
- `npx tsx --experimental-test-module-mocks --test src/features/vector/lib/*.test.ts src/lib/swing/play-brief*.test.ts` → 2454/2454 pass.
- `npx tsx --experimental-test-module-mocks --test src/lib/bie/*.test.ts` → 787/787 pass.
- `npx tsc --noEmit` → clean.
