> **kind:** FINDING

## Night Hawk Legacy: bearish-posture's "flipped to short" count was structurally always zero, and edition-builder.ts's own comment/log claimed a behavior the code deliberately never performs

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `applyBearishPosture` / `PostureResult` (`src/features/nighthawk/lib/bearish-posture.ts`, PR-N9's bearish-tape re-ranking) and its one caller, `edition-builder.ts`'s evening funnel (Stage 4c) |
| **Severity** | P3 — no member-facing or grading impact (this only affects an internal `console.info` diagnostic log line and a code comment), but it is a real, provable inconsistency between what the code does and what the code and its caller both claim it does, in a stage the operator has repeatedly said to keep auditing for richness/correctness. |

### Root cause

`applyBearishPosture` declared a `flipped` counter, initialized it to `0`, and never incremented it anywhere — the function only adjusts `score` (a bonus for existing SHORT candidates, a penalty for LONG candidates) and re-sorts; it never changes any candidate's `direction`. This is by explicit design, stated in the function's own inline comment: *"We deliberately do NOT flip a long to short here: the sub-scores... were all computed for the LONG direction and would be wrong on a flipped short."*

But the field was named and documented as if flipping were a real, counted behavior (`/** Count of candidates whose direction was flipped to SHORT. */`), and its one caller, `edition-builder.ts`, compounded the drift:
- Its own comment claimed *"Thin-flow longs get flipped to short"* — directly contradicting `bearish-posture.ts`'s own comment one file over.
- Its `console.info` diagnostic printed `` `${postureResult.flipped} candidate(s) flipped to short` `` — a log line that could structurally never report anything but `0`, on every single bearish-posture-engaged night, forever.

All 6 existing tests in `bearish-posture.test.ts` already asserted `result.flipped === 0` in every scenario (including titles like *"thin-flow long candidates are penalized, not flipped"*) — the test author clearly knew flipping never happens, but the dead field, the misleading type doc, and the caller's stale comment/log were never cleaned up to match.

### Blast radius

Confirmed via repo-wide grep: `applyBearishPosture`/`PostureResult` has exactly one caller (`edition-builder.ts`) and `.flipped` had no other readers anywhere in the codebase — this is contained entirely to this one module pair, its tests, and one log line. No member-facing UI, API response, or grading path reads this field.

### Fix

Replaced the dead `flipped: number` field with two fields that reflect what the function actually, provably does: `shortsBoosted: number` (existing-SHORT candidates given the ranking bonus) and `longsPenalized: number` (LONG candidates given the ranking penalty). Updated `edition-builder.ts`'s comment to accurately describe the score-based re-ranking (explicitly noting candidates are never flipped, with the reason) and its log line to report the two new, real counts instead of a count that could never be anything but zero.

### Why this fix, not an alternative

Considered instead implementing REAL direction-flipping to make `flipped` meaningful — rejected: `bearish-posture.ts`'s own comment already explains why that would be wrong (a long's sub-scores are direction-specific; scoring a flipped-to-short candidate using its original long-direction sub-scores would produce an internally contradictory candidate). The deliberate no-flip design is correct; only the field name, its doc comment, and the caller's stale comment/log needed to be brought into agreement with it.

### Evidence

- All 6 pre-existing tests in `bearish-posture.test.ts` updated (renamed assertions from `result.flipped` to `result.shortsBoosted`/`result.longsPenalized`, with real expected counts per scenario — e.g. the mixed-batch test: 1 short boosted, 2 longs penalized).
- Full suite (Node 20) after the change: 14081/14084 pass, 0 fail, 3 skipped.
- `npx tsc --noEmit`: clean.
- Repo-wide grep confirms zero remaining references to `.flipped` on a `PostureResult`.

### What was deliberately left unchanged

`bearish-posture.ts`'s actual re-ranking logic (bonus/penalty magnitudes, the never-flip design, `detectBookPosture`'s 2-of-3 signal threshold) is completely untouched — this fix only replaces a permanently-dead, misleadingly-named diagnostic field with two real ones and corrects the stale comment/log that had drifted from the code's own documented intent.
