> **kind:** FINDING

## Vector — whole orphaned `VectorGexLadder` component, superseded 2026-08-14, still had a wasted bug fix applied 5 days later — FIXED

**Symptom:** `VectorGexLadder.tsx` (470 lines, with substantial engineering history — the git
log shows 5+ real bug-fix PRs touching it) is a fully unrendered component. Zero imports
anywhere in `src/` outside its own definition and a dedicated regression test
(`vector-gex-ladder-fetch-cadence.test.ts`) that asserts against its SOURCE TEXT via
`readFileSync` — the test never actually renders or imports the component, so it does not
establish a real caller either.

**Root cause:** PR #2200 (`feat(vector): replace GEX ladder left rail with 0DTE matrix`,
2026-08-14) replaced `VectorGexLadder` with `VectorOdteMatrixRail` in `VectorPageShell.tsx`
— confirmed via `git log --diff-filter=A` on `VectorOdteMatrixRail.tsx` showing that exact
commit as its introduction, and `VectorPageShell.tsx:992` now renders
`<VectorOdteMatrixRail .../>`, not the ladder. The old component file was never deleted.

**This isn't just stale — it cost real, wasted engineering effort.** PR #2363
(`perf(vector): the GEX ladder re-fetched on every SSE spot tick`, 2026-08-19) — FIVE DAYS
AFTER #2200 made the component unreachable — fixed a genuine fetch-storm bug inside
`VectorGexLadder.tsx` (a `useEffect` dependency on the ~1Hz `liveSpot` prop was re-issuing
a non-cheap `/api/market/vector/gex-ladder` request 5-15× the intended rate). That fix, its
detailed root-cause comment, and its 4-test regression suite are all real and correct — but
they protect code nothing renders. The lib helpers the component called
(`buildGexLadder`/`vectorWallsScopePollMs`/`rowsInBand`/`scrollOffsetForSpot`) are unaffected
— each has other live callers (the `/api/market/vector/gex-ladder` route,
`src/lib/bie/vector-full-state.ts`, `VectorOdteMatrixRail.tsx` itself).

**Evidence:** `grep -rn "VectorGexLadder" src/` before the fix: only the component's own
definition and the source-text test. `grep -rln "VectorOdteMatrixRail" src/` confirms it's
rendered in `VectorChart.tsx` and `VectorPageShell.tsx`. `git log --oneline --diff-filter=A
-- src/features/vector/components/VectorOdteMatrixRail.tsx` → `e50c85b5d` (#2200,
2026-08-14 18:04:14); `git show -s --format=%ai 6b937be17` (#2363) → 2026-08-19 13:59:55 —
confirms the later fix landed on already-dead code.

**Fix:** Deleted `VectorGexLadder.tsx` and `vector-gex-ladder-fetch-cadence.test.ts`
entirely. Confirmed every helper the component imported has another real caller before
leaving the lib layer untouched.

## Vector — dead `VectorDrawToolbar` deprecated alias, justification no longer held — FIXED

**Symptom:** `VectorDrawToolbar.tsx` exported `export const VectorDrawToolbar =
VectorDrawToolsMenu;` with a comment: `/** @deprecated Use VectorDrawToolsMenu — kept for
import stability in tests/scripts. */`. Zero matches for the name `VectorDrawToolbar`
anywhere in `src/` (including every test file) or `scripts/` — the one real consumer,
`VectorToolbar.tsx`, imports `VectorDrawToolsMenu`/`VectorDrawToolsProps` directly from the
same file path, never the alias name itself.

**Root cause:** The alias's own stated justification ("kept for import stability in
tests/scripts") no longer applies — nothing currently imports it by that name. Whatever
test/script once needed it has since been updated to import the real name directly, and the
alias was never cleaned up afterward.

**Fix:** Removed the alias export.

**Fix rationale:** Pure deletion in both cases — one whole unrendered component with a
confirmed, dated supersession commit, and one deprecated alias whose own justification is
independently verified to no longer hold.

**Blast radius:** `src/features/vector/components/VectorGexLadder.tsx` (deleted),
`vector-gex-ladder-fetch-cadence.test.ts` (deleted), `VectorDrawToolbar.tsx` (one export
removed) only.

**Regression guard:** None needed — `VectorOdteMatrixRail`'s own test coverage already
protects the live replacement; the deleted ladder test only ever guarded dead code.
