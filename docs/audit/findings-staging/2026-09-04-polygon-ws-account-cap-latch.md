# Polygon WS account-cap cluster latch — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **What prompted this** | RTH 09:35 ET 2026-09-05: `socket-health` HTTP 503 — `polygon_indices` cluster I:SPX snapshot stale. CloudWatch: `[polygon-socket] indices REFUSED — Polygon account is at its WebSocket connection limit` in a connect→auth→refuse loop every ~60s since ~11:41 UTC. |
| **Root cause** | Per-socket 60s cooldown still allowed indices/options/stocks to compete for scarce account slots; each retry completes handshake+auth before refusal, pinning the account at its connection cap. |
| **Fix** | Redis latch `polygon:ws:account_cap_until` (5 min TTL) set on any cap refusal; all Polygon sockets honor `readPolygonAccountCapPauseMs()` before reconnect/connect. Per-socket cooldown raised to 180s. |
| **Status** | FIXED |

## Market-open validation

After deploy: `socket-health` returns 200 with `polygon_indices.ok=true` and CloudWatch shows sustained `indices authenticated` without `REFUSED` spam.
