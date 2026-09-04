## 2026-09-04 — [P2 ops] socket-health HTTP 503 false-negative on web tier during RTH — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 — ops/deploy probe false warn; cron `socket-health` reported unhealthy cluster while live desks were GREEN |
| **Found by** | Autopilot RTH lifecycle (`validate:deploy` socket-health HTTP 503 warning) |

### Root cause

1. **`GET /api/cron/socket-health`** rolled up `ok: false` (HTTP 503) when `polygon_indices.cluster_live` was false on a **web-tier** replica, even though `unusual_whales.ok` and `options.ok` were true (`ingest leader lock held — marks warming`). Web tier does not boot local polygon indices WS — ingest owns that feed.
2. **`validate:deploy`** only treated `options.ok` as healthy when HTTP status was **200**, so it warned `socket-health probe HTTP 503` despite `websockets.options.ok === true` (same class as the RTH-open retry false-fail fixed earlier today).

### Fix

- `aggregateSocketHealthOk()` in `socket-cluster-health.ts` — web tier (`boot_sockets: false`) does not require polygon cluster snapshot when UW cluster is live.
- `socket-health/route.ts` uses the shared rollup helper.
- `deploySocketHealthVerdict()` in `rth-socket-probe.mjs` — `validate:deploy` passes when `options.ok` regardless of top-level HTTP status.

### Evidence

- Live probe during RTH: HTTP 503 body had `options.ok: true`, `unusual_whales.ok: true`, `polygon_indices.ok: false` — `platform-integrity` simultaneously GREEN on SPX spot/matrix.
- `npx tsx --test src/lib/ws/socket-cluster-health.test.ts scripts/lib/rth-socket-probe.test.mjs` — GREEN

### Market-open validation

During RTH, `GET /api/cron/socket-health` with prod `CRON_SECRET` should return HTTP **200** on web-tier replicas when UW cluster heartbeat is fresh and options ingest leader is held — not 503 solely due to missing polygon cluster snapshot.
