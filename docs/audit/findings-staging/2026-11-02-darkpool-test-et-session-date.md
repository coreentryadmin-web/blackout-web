> **kind:** `FINDING`

## Dark-pool WS/cache tests used UTC calendar date while normalizers filter on ET session — FIXED

| **Status** | FIXED — branch `fix/uw-darkpool-ws-normalize-ci` |

| Field | Detail |
|---|---|
| **Symptom** | `verify` on `main` @ `1c760ad` failed `normalizeDarkPoolWsPayload scopes to onlyTicker...` (`undefined !== 2`) and `readUwDarkPoolFromRedis falls back to a reshaped market-wide snapshot...` (`a fresh market-wide cache entry must not be discarded as empty`). |
| **Root cause** | Both tests built `executed_at` with `new Date().toISOString().slice(0, 10)` (UTC date) while `normalizeDarkPoolWsPayload` / `darkPoolSnapshotFromRecentRows` drop rows whose ET session date ≠ `todayEt()`. Around 00:00–04:59 UTC the UTC and ET session dates diverge, so every row was filtered out and snapshots were null. |
| **Fix** | Use `todayEt()` from `et-date.ts` when constructing fixture timestamps in `uw-ws-normalize.test.ts` and `uw-ws-cache-bridge.test.ts`. |
| **Evidence** | CI run `41366602528` job `verify`; local `npx tsx --test src/lib/providers/uw-ws-normalize.test.ts` green. |
