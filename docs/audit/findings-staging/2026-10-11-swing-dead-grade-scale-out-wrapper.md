## Swing `gradeSwingScaleOut` — dead parity wrapper, real caller already bypasses it — FIXED

> **kind:** `FINDING`

| **Status** | Fixed in PR (fix/swing-dead-grade-scale-out-wrapper) |
|---|---|

**Symptom:** none live — pure dead code found during a routine DISCOVERY-lane sweep, not a
production defect.

**Root cause:** `gradeSwingScaleOut` (`src/lib/swing/grade.ts`) was a thin pass-through wrapper
over `gradeBangerScaleOut`, documented ("exists only so swing callers have a swing-named entry
point") as the FINANCIAL truth family's intended route into the shared scale-out grader. The real
caller — `gradeSwingPosition`'s inline financial-grading block, same file — calls
`gradeBangerScaleOut` **directly**, bypassing the wrapper entirely; the wrapper's only consumer was
its own parity test (`grade.test.ts`, asserting `gradeSwingScaleOut(...) === gradeBangerScaleOut(...)`,
which is trivially true for a pass-through and exercises nothing the real financial-grading tests
elsewhere in the same file don't already cover).

**Evidence:** `grep -rwn "gradeSwingScaleOut" --include=*.ts --include=*.tsx --include=*.mjs
--include=*.md src scripts docs` → the function's own definition/doc comment, its direct parity
test, and 3 cross-file prose references (`docs/audit/OUTCOME-GRADING-SPEC.md`,
`docs/audit/SWING-ENGINE.md`, `scripts/audit/swing-sim.mjs`'s header comment) all describing it as
the production path — none of which is true: `swing-sim.mjs` imports and calls only
`gradeSwingPosition` (the real caller), never this wrapper.

**Fix:** Removed `gradeSwingScaleOut` from `grade.ts` and its now-unused `BangerScaleOutGrade` type
import. Removed the parity test and its own now-unused imports from `grade.test.ts` (the file's
other FINANCIAL-family tests already exercise the real `gradeBangerScaleOut` call inside
`gradeSwingPosition`). Corrected the 3 stale cross-file references (`OUTCOME-GRADING-SPEC.md`,
`SWING-ENGINE.md`, `swing-sim.mjs`'s header comment, plus `grade.ts`'s own header comment) to
describe the actual call path — `gradeSwingPosition` calling `gradeBangerScaleOut` directly — rather
than a wrapper that was never in the real path.

**Fix rationale:** Pure deletion, no behavior change — the real financial-grading output is
unchanged (it already came from the direct call, not the wrapper). Fixed the stale documentation
in the same PR rather than leaving 3 files making a now-false claim about the call path, since that
claim was the exact thing this finding falsifies.

**Blast radius:** `src/lib/swing/grade.ts`, `src/lib/swing/grade.test.ts`,
`docs/audit/OUTCOME-GRADING-SPEC.md`, `docs/audit/SWING-ENGINE.md`, `scripts/audit/swing-sim.mjs`
(comment only in the last 3 — no executable logic changed in docs/scripts).

**Regression guard:** `grade.test.ts` 16/16 pass (Node 20, `--experimental-test-module-mocks`).
`tsc --noEmit` clean.
