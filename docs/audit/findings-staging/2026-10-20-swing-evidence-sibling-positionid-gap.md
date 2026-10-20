## evidenceFromContext's sibling-count feeder lacked the positionId exact-match branch, letting envelope.evidence silently disagree with "Other concurrent position(s)" — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate static-code sweep (Workflow correctness audit of
`play-brief.ts`/`play-brief-narrative.ts`/`play-brief-intel.ts`).

**Root cause:** `siblingPositionsNote` (`play-brief.ts`, the function that renders the "Other
concurrent position(s)" section) tests sibling identity two ways: an exact `r.positionId !==
selfPositionId` match when both sides carry a positionId (added 2026-10-11 specifically because the
premium-proximity heuristic is known-wrong), falling back to `Math.abs(r.entryPremium -
play.entry!) > 0.005` only when no positionId is available.

`evidenceFromContext`'s sibling-count block — whose sole job, per this file's own Largo C7 doctrine
("the sibling-positions section makes a concrete, checkable claim — it must have a matching
envelope.evidence entry"), is to back that exact section — reimplements the same filter but omitted
the positionId branch entirely, falling straight to the premium-proximity test. The governing
comment directly above it explicitly claimed the two functions were "Fixed in lockstep" and "can
never disagree" — but it only ported the 2026-10-15 bucket-gating (`!== "closed"`) and
entry-premium-precondition fixes, never the earlier (2026-10-11) positionId branch added to
`siblingPositionsNote` for exactly this scenario.

**Live impact:** Two real, independently-committed native swing positions on the same ticker with
distinct positionIds (legitimately separate per `commit.ts`'s per-archetype `swingThesisKey`
idempotency) whose entry premiums happen to land within $0.005 of each other (a realistic fill
collision) — `siblingPositionsNote` correctly resolves the positionId mismatch and renders the
section, while `evidenceFromContext`'s premium-proximity fallback incorrectly treats the sibling as
"self" and emits zero evidence entries. The test suite's own AMD regression test for this exact
scenario (entries $17.73 vs $17.7301, distinct positionIds) only asserted `envelope.sections`, never
`envelope.evidence` — unlike its sibling tests immediately before/after, which both assert the
evidence entry — because adding that assertion would have failed.

**Fix:** Port the identical positionId exact-match branch into `evidenceFromContext`'s sibling-count
filter, matching `siblingPositionsNote` line for line.

**Fix rationale:** Minimal — the exact same logic already exists and is proven correct one function
away; this duplicates it rather than refactoring both call sites to share one helper, matching the
file's existing style (the premium-proximity fallback is already duplicated the same way).

**Blast radius:** Single block inside `evidenceFromContext` (`play-brief.ts`). No other caller of
this filter.

**Tests:** Extended the existing AMD regression test (`play-brief.test.ts`, "a same-ticker sibling
with a near-identical entry premium is still disclosed") with the missing `envelope.evidence`
assertion, matching its sibling tests. RED→GREEN proven via `git stash` on just the source file
(new assertion failed pre-fix — no evidence entry emitted — passes post-fix). Full
`play-brief.test.ts` (158 tests) green on Node 20. `tsc --noEmit` clean.
