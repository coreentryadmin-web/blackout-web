## Largo swing play-brief adapter: evidence_numbers level price uses raw `toFixed` instead of `fmtPriceLevel` — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Ask Largo swing play-brief adapter (`src/lib/swing/play-brief-adapter.ts`) |
| **Found by** | Ask Largo fan-out audit (8-ticker parallel workflow, adversarially verified), 2026-10-24, live repro SOXX |

### Symptom

SOXX's live swing play-brief: top-level `evidence_numbers` read `"flag anchor: $479.20"` while `envelope.levels[0].price` was `479.21` and the "Watch levels" section body text read `"Flag anchor: **479.21**"` — the same underlying value (`play.flagUnderlyingPx`) rendered as two different numbers in the same response.

### Root cause

`extractEvidence()` (`play-brief-adapter.ts:84`) called `level.price.toFixed(2)` directly on the raw, pre-rounded float from `envelope.levels`. The API route rounds that same field via `roundFloats`'s `Math.round(n*100)/100` at the response boundary, and every other renderer in this codebase (`play-brief.ts`, `play-brief-narrative.ts`, `play-brief-narrative-coaching.ts`, `play-brief-intel.ts`) already migrated to the shared `fmtPriceLevel()` helper specifically to avoid this class of disagreement (documented at length in `fmt-money.ts`'s own header, citing a prior live repro). `play-brief-adapter.ts` was never migrated — this is the 8th known call site of the same bug class, not a new pattern. Mechanism: `(479.205).toFixed(2)` → `"479.20"`, `Math.round(479.205*100)/100` → `479.21`.

### Fix

Switched the levels loop to `fmtPriceLevel(level.price)`, matching every sibling renderer.

### Evidence

- RED→GREEN: new test injects a level price on the exact half-cent boundary (`479.205`); fails against pre-fix source (`git stash`), passes after.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief*.test.ts` → 1149/1149 pass (Node 20).
- `npx tsc --noEmit` → clean.
