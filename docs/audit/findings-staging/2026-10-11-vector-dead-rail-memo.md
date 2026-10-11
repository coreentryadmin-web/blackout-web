## Vector `vector-wall-persist.ts` — orphaned `railMemo` subsystem, drifted dead after the append-only rail migration — FIXED

> **kind:** `FINDING`

| **Status** | Fixed in PR (fix/vector-dead-rail-memo) |
|---|---|

**Symptom:** none live — pure dead code found during a routine DISCOVERY-lane sweep, not a
production defect.

**Root cause:** `railMemo` (module-level `Map`), `RAIL_MEMO_RESYNC_MS`, `railMemoNeedsResync()`,
and `nextRailMemoAt()` were built 2026-08-18 to remove ~488 whole-rail Redis GET+JSON.parse
round-trips per 5s sweep by memoizing each session's rail in-process between writes. The very next
day (2026-08-19, per the test file's own "APPEND-ONLY RAIL" comment) `appendSessionWallSample` was
migrated to an O(1) Redis `RPUSH`-based append (`sharedListAppend`), which has no notion of a
memoized rail at all — dedupe moved to the read side (`loadSessionWallHistory`). That migration
orphaned the whole memo subsystem, but only its test-only reset hook was cleaned up at the time.

**This is a regression since the last audit, not a freshly-missed item:** `docs/audit/FINDINGS.md`
(2026-09-06, "Dead code: 9 Vector desk exports") explicitly removed `_resetWallRailMemoForTest` (a
test-only reset hook for this same `railMemo`) and left `railMemo`/`railMemoNeedsResync`/
`nextRailMemoAt` alone at that time — meaning the map itself was still considered live then (the
2026-08-19 RPUSH migration predates that audit, so this should have been caught then too, but
wasn't — the reset-hook removal looked at the map's test surface, not whether the map was still
read anywhere in production code).

**Evidence:** `grep -n "railMemo\b" src/features/vector/lib/vector-wall-persist.ts` → only the
map's own declaration (line 281 pre-fix) — never read or written anywhere else in the file,
confirming `appendSessionWallSample`'s real RPUSH path never touches it.

**Fix:** Removed `railMemo`, `RAIL_MEMO_RESYNC_MS`, `railMemoNeedsResync()`, `nextRailMemoAt()`, and
the now-stale comment block describing the GET-modify-write design they served. Removed the 4 tests
exercising them and their now-unused imports from `vector-wall-persist.test.ts` (the "RAIL MEMO
RESYNC CLOCK" section) — the adjacent "APPEND-ONLY RAIL" test section, which documents and tests
the actual current behavior, is untouched.

**Fix rationale:** Pure deletion — nothing in the real append/read path called any of these.

**Blast radius:** `src/features/vector/lib/vector-wall-persist.ts`,
`src/features/vector/lib/vector-wall-persist.test.ts` only.

**Regression guard:** `vector-wall-persist.test.ts` 16/16 pass (Node 20,
`--experimental-test-module-mocks`). `tsc --noEmit` clean.
