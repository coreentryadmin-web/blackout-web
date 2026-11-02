> **kind:** FINDING

## Dark-pool WS unit tests used UTC calendar date while shapers filter on ET session date

| **Status** | FIXED (test harness) |
| --- | --- |

### What was broken

`uw-ws-normalize.test.ts` and `uw-ws-cache-bridge.test.ts` built `executed_at` stamps with `new Date().toISOString().slice(0, 10)` (UTC). `normalizeDarkPoolWsPayload` and `darkPoolSnapshotFromRecentRows` drop rows whose ET session date ≠ `todayEt()`. After 00:00 UTC but before midnight ET (common for late-evening US CI/agent runs), every row was filtered → `normalizeDarkPoolWsPayload(mixed)` returned `null` and `readUwDarkPoolFromRedis("SPX")` fallback returned `null`, failing `verify`.

### Fix

Import `todayEt()` from `src/lib/et-date.ts` in both tests and use it for same-session timestamps.

### Verify on merge

`npm test` / CI `verify` — no live UI check required (test-only).
