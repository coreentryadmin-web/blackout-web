> **kind:** FINDING

## Night Hawk Vector board — 6 dead exports + 2 orphaned types across 3 files — FIXED

**Symptom:** Sweeping the "vector-board" cluster found 6 zero-caller functions and 2
types left over once their only consumer was removed, across
`vector-board-filters.ts`, `vector-board-table-utils.ts`, and
`vector-pick-log-board-utils.ts`:
- `vectorBoardSessionPnl` (`vector-board-filters.ts`) — zero callers anywhere outside
  its own self-test.
- `vectorBoardNetPnl` (same file) — `vectorBoardSessionPnl`'s only caller was itself
  dead, and `vectorBoardNetPnl` had no OTHER caller either (confirmed separately — it
  has its own direct self-test, so it wasn't exclusively a helper for
  `vectorBoardSessionPnl`, but it was still never called by production code).
- `filterVectorBoardRows` (`vector-board-table-utils.ts`) — zero callers anywhere,
  including no test reference outside its own. The real, live filter components use is
  `filterVectorBoardRowsAdvanced` (`vector-board-filters.ts`, confirmed wired into
  `VectorPickLogBoard.tsx` and `LegacyPickLogBoard.tsx`) — a same-named-but-different
  sibling in a different file, which is almost certainly why this one drifted dead
  without anyone noticing (easy to assume the "Advanced" one supersedes it, which is
  exactly what happened).
- `vectorBoardSummary` (same file) — zero callers outside its own self-test.
- `preferredVectorBoardSection` (`vector-pick-log-board-utils.ts`) — zero production
  callers; only its own 4 self-tests.
- `filterVectorClosureRows` / `sortVectorClosureRows` (same file) — zero callers
  anywhere, not even a test.
- `VectorBoardSection` (same file) — the type `preferredVectorBoardSection` returned;
  no other reference anywhere once that function is gone.
- `VectorClosureSort` (same file) — the type `sortVectorClosureRows` took; no other
  reference anywhere once that function is gone.

**Root cause:** Each had a live sibling doing the real job, or was never wired up after
being built — not a correctness regression. `classifyVectorClosureReason` (same file as
the two closure-row helpers) IS live (`vector-board-filters.ts:115`), confirming the
closure-filtering/sorting logic itself did get built into production, just via a
different, inline path rather than through these two named utilities.

**Evidence:** `grep -rn "<name>"` per export, repo-wide, before the fix: each matched
only its own definition (plus, where present, its own self-test). Cross-checked
`VectorPickLogBoard.tsx` / `LegacyPickLogBoard.tsx` / `VectorBoardToolbar.tsx` /
`VectorBoardFiltersDrawer.tsx` directly — none imports any of the 6 removed functions.

**Fix:** Removed all 6 functions, both now-orphaned types, and their imports/tests.
`vectorBoardNetPnl` and `vectorBoardSessionPnl` removed together since the former's
only other justification (feeding the latter) was itself dead. Left
`vectorBoardCalendarBuckets`, `vectorBoardMeter`, `filterVectorRunnerLeaders`,
`classifyVectorClosureReason`, `filterVectorBoardRowsAdvanced` untouched — all confirmed
live via real component imports.

**Fix rationale:** Pure deletion throughout — no gap left behind, since every removed
function's real job (where one existed) is already done by a live sibling.

**Blast radius:** `vector-board-filters.ts` (+test), `vector-board-table-utils.ts`
(+test), `vector-pick-log-board-utils.ts` (+test) only.

**Regression guard:** None needed — no removed function had production behavior to
guard; the self-tests removed had no value beyond re-confirming a now-deleted
function's own body.
