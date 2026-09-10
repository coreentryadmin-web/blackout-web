## 2026-09-10 — wrong_direction suggestion text (PR #4725) had a broken clause — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **How found** | Self-review immediately after PR #4725 merged (`ef67b1f`): re-read the merged text on `origin/main` as part of the standing "a merge is not a verification" re-check, and the residual-gap clause did not parse — *"the residual gap is calls the tape reads as 'mixed' or agreeing but that still miss"* is not grammatical English. |
| **Root cause** | Introduced while writing PR #4725's fix in the same cycle — an edit left a dangling clause ("is calls the tape reads... but that still miss") instead of the intended "the residual gap is calls whose tape reads 'mixed' or agrees but the call still misses". Purely a wording defect in a suggestion string; no logic, test, or behavior was affected — `debrief-aggregate.test.ts`'s regex assertions (`/G-N4/`, not `/add a book-vs-tape/i`) don't touch this clause, so it shipped clean through CI. |
| **Fix** | Corrected the clause to "the residual gap is calls whose tape reads 'mixed' or agrees but the call still misses". |
| **Blast radius** | Single string, same map entry PR #4725 touched. No test change needed — existing assertions already cover the substantive claims (names G-N4, doesn't claim the gate is missing); this is prose polish only. |
| **Evidence** | `debrief-aggregate.test.ts`: 27/27 pass (unchanged). `npx tsc --noEmit -p .`: clean. `npx eslint`: clean. |
| **Status** | FIXED — pushed directly to `main` as a trivial follow-up to the just-merged PR #4725 (same file, same cycle, wording-only). |
