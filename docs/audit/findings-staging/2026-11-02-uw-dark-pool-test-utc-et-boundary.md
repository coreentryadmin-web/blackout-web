> **kind:** FINDING

## Two UW dark-pool test fixtures stamp "today" via UTC instead of ET — fails deterministically for several hours every evening — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** investigating PR #7323's (SPX closed-market VIX-blind target fix) unexpectedly red
`verify` CI check — the failure traced to two test files wholly unrelated to that PR's diff,
confirmed to fail identically and deterministically on `main` itself (3/3 local re-runs at
~00:06–00:09 UTC on 2026-11-02, with 2026-11-01 DST end making ET = UTC−5 — i.e. squarely inside
the UTC-rolled-over-but-still-yesterday-in-New-York window). This is the same documented UTC-vs-ET
calendar-date mismatch bug class CLAUDE.md already warns about, hitting two more sites.

**Root cause:** both files compute a fixture `today` via `new Date().toISOString().slice(0, 10)`
(UTC calendar date), then feed it into a function under test that filters rows against
`todayEt()` (`src/lib/et-date.ts`, US/Eastern calendar date). The two disagree for several hours
every day — whenever UTC has rolled to a new date but it's still the previous day in New York
(roughly 7pm–midnight ET depending on DST) — so a row stamped `${today}T...Z` using the UTC date
lands in the *next* ET session and gets dropped by the function's own `today`-session filter.

- `src/lib/uw-ws-cache-bridge.test.ts` — "readUwDarkPoolFromRedis falls back to a reshaped
  market-wide snapshot when the ticker key is empty" feeds a fixture row into
  `readUwDarkPoolFromRedis` → `darkPoolSnapshotFromRecentRows(rows, today: string = todayEt())`
  (`uw-ws-cache-bridge.ts:120-123`), which defaults its own `today` param to `todayEt()`. Introduced
  by my own earlier merge, PR #7320 (commit `81f0490b8`).
- `src/lib/providers/uw-ws-normalize.test.ts` — "normalizeDarkPoolWsPayload scopes to onlyTicker —
  a market-wide WS frame does not blend another ticker's prints into the SPX snapshot" feeds a
  fixture into `normalizeDarkPoolWsPayload`, which computes `const today = todayEt();` internally
  (`unusual-whales.ts:1307`) and filters every row's `executed_at` against it. Pre-existing, from
  PR #7307 (commit `b75e6722b`) — predates this session.

**Evidence (RED → GREEN):** both files failed deterministically on fresh `origin/main`
(post-#7322, 3/3 local runs) with the identical assertion error — ruled out as flake per the
babysit-CI-red re-run discipline. Fix: swap each fixture's `today` computation for `todayEt()`
(imported from `./et-date` / `../et-date` respectively), matching the real filter the function
under test actually applies. GREEN: `npx tsx --experimental-test-module-mocks --test
src/lib/uw-ws-cache-bridge.test.ts src/lib/providers/uw-ws-normalize.test.ts` → 17/17 pass (Node
20). `npx tsc --noEmit`: clean.

**Blast radius:** test-only — no production code changed. Both files' `today`-based fixtures were
the only UTC-vs-ET mismatches in each file (the other fixtures in both files already either don't
depend on same-session filtering or already imported `todayEt()`/pass an explicit `today` arg).
This was blocking CI for *any* PR right now, not just the one that surfaced it (PR #7323) — any
open or future PR rebasing onto `main` during the UTC/ET mismatch window would hit the same two
failures regardless of its own diff.

**Fix rationale:** match the fixture to the real filter (`todayEt()`) rather than loosening the
function under test's own filtering logic — the function's ET-session filtering is itself correct
and documented (`et-date.ts`'s own "MONEY-PATH INVARIANT" header); the bug was purely in the test
fixtures disagreeing with it.
