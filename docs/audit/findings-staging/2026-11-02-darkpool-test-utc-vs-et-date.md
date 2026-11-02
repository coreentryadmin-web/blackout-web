> **kind:** FINDING

## Dark-pool WS tests used UTC YMD while filters use todayEt() — FIXED

| **Status** | Fixed on `fix/darkpool-ws-test-today-et` |

**Symptom:** `main` verify red on docs-only `1c760ad54` — `normalizeDarkPoolWsPayload scopes to onlyTicker` (`undefined !== 2`) and `readUwDarkPoolFromRedis` market-wide fallback (`null`).

**Root cause:** Tests stamped `executed_at` with `new Date().toISOString().slice(0, 10)` (UTC calendar day) while `normalizeDarkPoolWsPayload` / `darkPoolSnapshotFromRecentRows` drop rows when exec day !== `todayEt()`. After 00:00 UTC while still prior ET session day, all rows filter out.

**Fix:** Use `todayEt()` for fixture dates in `uw-ws-normalize.test.ts` and `uw-ws-cache-bridge.test.ts`.
