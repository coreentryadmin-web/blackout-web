> **kind:** FINDING

## `recordVectorWallSamplesFromWarm` — orphaned by the full-universe bead-recorder refactor — FIXED

**Area:** `src/features/vector/lib/vector-snapshot.ts` (Vector GEX/VEX wall-history recording)

### Root cause

`recordVectorWallSamplesFromWarm(ticker)` was added same-day as, and specifically to be called
by, `vector-walls-warm.ts`'s `warmVectorWalls` — commit `322d53028` / `36d084817`
("fix(vector): denser bead rails for SPY/QQQ/NVDA", 2026-08-05) rewired
`warmVectorWalls` from a cache-only read (`getVectorGexWalls`/`getVectorVexWalls`) to call this
new function, specifically so non-SPX names would accumulate wall-history beads every ~15-30s
without requiring a live Vector viewer.

That approach was superseded **the same day**, inside the same PR (#1708,
`31b67d359`, "fix(vector): 5s bead rails for full universe (~100 tickers), viewer-independent"):
its own commit body states *"vector-walls-warm back to cache-only; walls warm uses full shared
universe"* — the warm-path recording job moved to a dedicated 5s, Redis-elected leader
(`vector-bead-recorder-leader.ts` → `recordSharedUniverseWallSamples` →
`recordVectorUniverseWallSample` in `vector-universe.ts`, a completely separate implementation
that calls `buildNarrowedHorizonWallSamples` directly rather than through
`recordVectorWallSamplesFromWarm`). `vector-walls-warm.ts`'s current (and, per `git log -S`, every
version since that same day) `warmVectorWalls` only calls
`getVectorGexWalls`/`getVectorVexWalls`/`primeVectorWallScope` — cache warming only, exactly as
its own top-of-file comment says ("Wall-history bead recording is owned by
vector-bead-recorder-leader (5s, full universe)").

The old function was left behind in `vector-snapshot.ts`, still `export`ed, with its original
JSDoc still claiming *"Used by vector-walls-warm (~15–30s) so SPY/QQQ/NVDA rails accumulate
server-side without requiring a live Vector viewer"* — a description of a wiring that stopped
being true within the same day it was written, and has been false for the ~3 months since.

### Evidence

- `git log --oneline --all -S"recordVectorWallSamplesFromWarm" -- src/features/vector/lib/vector-snapshot.ts`
  returns exactly the three commits above: the one that introduced it as the live implementation
  (`322d53028`/`36d084817`), and the one whose own commit message documents replacing it
  (`31b67d359`). No commit since has touched the symbol.
- Repo-wide search (`grep -rn "recordVectorWallSamplesFromWarm" --include=*.ts --include=*.tsx .`)
  finds exactly three hits: the function's own declaration, a mock entry in
  `vector-walls-warm.test.ts` (`namedExports: { recordVectorWallSamplesFromWarm: async () => true }`
  — never invoked by anything the test exercises), and an assertion message string inside
  `vector-wall-rail-rth-gate.test.ts`'s source-scan test. Zero real call sites, in a route, a cron,
  or any other library file.
- Confirmed the actual production wiring directly: `src/features/vector/lib/vector-walls-warm.ts`
  (`warmVectorWalls`) imports and calls only `getVectorGexWalls`, `getVectorVexWalls`,
  `primeVectorWallScope`; `src/app/api/cron/vector-walls-warm/route.ts` calls only
  `warmVectorWalls`/`getTickersToWarmAsync`. `src/features/vector/lib/vector-universe.ts`
  (the actual warm-path recorder, confirmed via `vector-bead-recorder-leader.ts` →
  `recordSharedUniverseWallSamples` → `recordVectorUniverseWallSample`) imports
  `buildNarrowedHorizonWallSamples` directly from `vector-snapshot.ts`, never the dead function.
- `npx tsc --noEmit` and the full Vector feature test suite (`find src/features/vector
  -name "*.test.ts"`, 164 files / 1425 tests) pass clean after removal, confirming zero live
  dependents.

### Blast radius

None beyond this one file plus the two test files that referenced the dead symbol by name:
- `src/features/vector/lib/vector-walls-warm.test.ts` mocked `./vector-snapshot` with a
  `recordVectorWallSamplesFromWarm` entry that `getTickersToWarm` (the only function under test)
  never called — removed from the mock, test behavior unchanged.
- `src/features/vector/lib/vector-wall-rail-rth-gate.test.ts` had one source-scan test
  ("the RTH gate is evaluated BEFORE the staleness check, not merged into it") written
  specifically against the dead function's early-return shape
  (`if (!wallRailRecordingOpen()) return false;`). Rewrote it to scan the equivalent invariant on
  the one remaining in-process rail writer, `buildVectorStreamPayload` (its combined
  `if (wallRailRecordingOpen() && (gexRecordable || vexRecordable))` condition, with the
  staleness-derived `gexRecordable`/`vexRecordable` computed before that check uses them) — same
  intent (RTH openness gates the staleness-derived recordable flags, not the reverse), now pinned
  against the code path that is actually live. The other 7 tests in that file (the
  `persistWallSampleDebounced`-gate scan, the `writeWallHistorySample`/`isEtCashRth` scans, the
  `wallRailRecordingOpen` docblock scan, the leader-agreement scan, the spot-guard scan) already
  targeted live code and are untouched.
- `STALE_RECORD_MAX_MS`, `wallRailRecordingOpen()`, `isWsUpdatedAtFresh`, `resolveWallTrailSampleSec`,
  `bucketWallSampleTime`, `buildWallHistorySample`, `recordWallSample`, `todayEtYmd`,
  `primeVectorWallScope`, `getVectorBeadRailGexWalls`, `getVectorVexFlip` all remain in active use
  elsewhere in `vector-snapshot.ts` (verified via per-symbol occurrence counts) — nothing else was
  orphaned by the removal. Only the now-unused `writeWallHistorySample` import (used exclusively by
  the dead function) was dropped; `persistWallSampleDebounced` from the same module stays, still
  used by the live writer.

### Fix rationale

Removed the dead function outright rather than re-wiring it: the full-universe bead-recorder
(`vector-bead-recorder-leader.ts`/`vector-universe.ts`) is the deliberate, already-shipped fix for
the exact problem this function was built to solve (SPY/QQQ/NVDA/non-viewed-ticker rail density),
and it already runs on a tighter cadence (5s, Redis-elected leader + 1/min HTTP backup) than the
~15-30s warm cron this function was meant to piggyback on. Resurrecting it would reintroduce a
second, less-capable, long-stale recording path with misleading documentation, not an improvement.

No behavior change for any live code path: `warmVectorWalls`, `buildVectorStreamPayload`, and
`vector-universe.ts`'s recording pipeline are all untouched by this PR. `tsc --noEmit`, eslint, and
the full Vector test suite all pass clean after the removal.

| **Status** | FIXED — dead export removed (orphaned ~3 months ago by the same-day full-universe bead-recorder refactor), zero real references confirmed via `git log -S` + repo-wide grep, two test files that named the symbol updated, full Vector suite (1425 tests) passes unchanged. |
|---|---|
