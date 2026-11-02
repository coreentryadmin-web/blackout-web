## 2026-11-02 — [FINDING] dark-pool WS tests used UTC date vs ET session filter — FIXED

> **kind:** `FINDING`

| Field | Detail |
| --- | --- |
| **Symptom** | `verify` on `1c760ad54` failed `normalizeDarkPoolWsPayload scopes to onlyTicker` (`undefined !== 2`) and `readUwDarkPoolFromRedis falls back…` around 00:22 UTC. |
| **Root cause** | Tests stamped `executed_at` with `new Date().toISOString().slice(0,10)` (UTC) while `normalizeDarkPoolWsPayload` / `darkPoolSnapshotFromRecentRows` filter on `todayEt()` — after midnight UTC, prints look like "tomorrow" in UTC but "today" in ET and get dropped. |
| **Fix** | Use `todayEt()` for test fixtures in `uw-ws-normalize.test.ts` and `uw-ws-cache-bridge.test.ts`. |
| **Status** | FIXED on `fix/uw-darkpool-ws-et-date-tests`. |
