> **kind:** FINDING

## Dark-pool regression tests used UTC calendar date while shapers filter on ET session date — FIXED

| | |
|---|---|
| **File** | `src/lib/providers/uw-ws-normalize.test.ts`, `src/lib/uw-ws-cache-bridge.test.ts` |
| **Status** | FIXED |
| **PR** | fix/darkpool-test-today-et |

### Root cause

New dark-pool tests built `executed_at` with `new Date().toISOString().slice(0, 10)` (UTC date) but
`normalizeDarkPoolWsPayload` / `darkPoolSnapshotFromRecentRows` compare against `todayEt()`
(America/New_York). After 20:00 ET (00:00+ UTC next day) through the rest of the UTC calendar day,
fixtures are stamped on "tomorrow" in UTC while production still filters on today's ET session — every
row is dropped, tests fail, and `main` verify goes red on an unrelated docs-only commit.

### Fix

Use `todayEt()` for fixture dates and mid-afternoon UTC instants that stay on that ET session day.

### Evidence

- RED: CI run `41366602528` on `1c760ad54` — `normalizeDarkPoolWsPayload scopes to onlyTicker…` and
  `readUwDarkPoolFromRedis falls back…`.
- GREEN: `npx tsx --test` on both files locally after fix.
