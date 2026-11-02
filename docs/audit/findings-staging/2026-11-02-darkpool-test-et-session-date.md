> **kind:** FINDING

## Dark-pool WS/cache regression tests used UTC calendar date after ET session filter shipped — FIXED

| **Status** | FIXED (test harness) |
|------------|----------------------|

**Symptom:** `verify` on `main` failed after ~00:00 UTC (still prior ET session evening) with `normalizeDarkPoolWsPayload scopes to onlyTicker` (`undefined !== 2`) and `readUwDarkPoolFromRedis falls back...` (`must not be discarded as empty`).

**Root cause:** Production normalizers (`normalizeDarkPoolWsPayload`, `darkPoolSnapshotFromRecentRows`) compare print dates to `todayEt()`. Two regression tests built fixture `executed_at` prefixes with `new Date().toISOString().slice(0, 10)` (UTC). After midnight UTC while ET is still the previous calendar day, every print is filtered out → `null` snapshots.

**Fix:** Use `todayEt()` for fixture dates in `uw-ws-normalize.test.ts` and `uw-ws-cache-bridge.test.ts`.

**Check:** Re-run full `verify` across the UTC/ET boundary window; both tests must stay green.
