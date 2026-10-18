> **kind:** FINDING

## SPX Slayer `score === clamp(sum(factors[].weight), -100, 100)` had no regression test — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (coverage gap, not a live bug — the invariant was measured intact this cycle) |
| **Found by** | 5-engine live monitor cycle, SPX Slayer live health check, 2026-10-18 |

### Root cause / gap

`computeSpxConfluence` (`src/features/spx/lib/spx-signals.ts`) builds its top-level `score` by
accumulating every pushed `factors[].weight` (`score += w; factors.push({..., weight: w, ...})`
throughout the function), then clamps the final sum to `[-100, 100]`. This invariant —
`score === clamp(sum(factors[].weight), -100, 100)` — is exactly the class of bug that already
drifted once before: `reclassifyConfluenceScore` exists specifically because a post-hoc score
mutation (a Night Hawk prior bonus applied after the main confluence computation) was once applied
to `score` without a matching `factors.push(...)`, desyncing the two.

Despite that history, no test asserted the invariant directly. `spx-signals.test.ts`'s existing
"byte-for-byte unchanged output" golden-fixture test incidentally encodes ONE data point of it
(raw sum 154, clamped to `score: 100`) but never states the relationship as an invariant, and
critically only exercises the **clamped** regime — a drift in the ordinary (unclamped) case could
ship invisibly. `rawScore` (a separate, intentionally different confidence formula:
`clamp(round(|score|*1.15 + factors.length*3), 0, 96)`) is easy to mistake for this invariant but
is NOT it — a `score`/factor-sum drift would not show up as a `rawScore` mismatch at all.

Live-confirmed this cycle (off-hours, flat board): `score=0`, `factors=[]`, sum=0 — trivially
consistent, so this cycle's live check could not have caught a real violation even if one existed
in a non-trivial case.

### Fix

Added two regression tests to `src/features/spx/lib/spx-signals.test.ts`:
1. **Clamped case** — reuses the existing `richDesk()` golden fixture (raw weight sum 154, > 100),
   asserts `result.score === clamp(sum(factors[].weight), -100, 100)` directly, and asserts the
   fixture genuinely exercises the clamp path (so the test can't silently stop testing what it
   claims to).
2. **Unclamped case** — a sparse variant of `richDesk()` with enough big-weight factors removed
   (γ regime, 0DTE flow, Market tide, HELIX sweeps, Live tape, Net prem, Strike stack, News risk,
   Mega-caps) that the raw sum stays well inside `[-100, 100]`, asserting `score` equals the raw
   sum exactly with no clamp distortion — proves the invariant in the ordinary regime, not just the
   saturated one the golden fixture happens to hit.

**Verified the tests aren't vacuous**: temporarily broke the invariant in `spx-signals.ts`
(`score = clamp(score, -100, 100) + 5`) and confirmed both new tests fail with a clear diff; reverted
immediately (`cp` from a backup, confirmed `git diff` empty) and re-ran to confirm GREEN again.

### Blast radius

Test-only change — `spx-signals.ts` itself is untouched; no production code or behavior change.

### Tests

`src/features/spx/lib/spx-signals.test.ts`: 13/13 pass (11 pre-existing + 2 new). `tsc --noEmit`:
clean.
