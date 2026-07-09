# Market-data worker (ingest tier)

Dedicated ECS Fargate service that owns upstream WebSocket leaders and the
in-process RTH warm leader. Web replicas serve HTTP/UI only and read hot snapshots
from Redis.

## Architecture

```
EventBridge crons ──► ALB ──► web ECS (PROCESS_ROLE=web, N tasks)
                                    │
                                    ▼ Redis / Postgres
market-worker ECS (PROCESS_ROLE=ingest, 1 task)
    └── UW / Polygon / options / LULD WebSockets (single leader each)
```

## Roles

| `PROCESS_ROLE` | WebSockets | RTH warm leader | ALB |
|----------------|------------|-----------------|-----|
| `web` | off (`DATA_SOCKETS_ENABLED=0`) | off | yes |
| `ingest` | on | on | no |
| unset / `all` | on (legacy Railway) | on | yes |

## ECS (Terraform)

- Web container liveness: `/api/health` (cheap — no DB ping)
- ALB target readiness: `/api/ready` (DB connectivity)
- Worker liveness: `/api/worker/health`
- Worker boot: `node deploy/market-worker.mjs` → `/api/worker/boot`
- Rolling deploy: `deployment_minimum_healthy_percent = 50` + circuit breaker

Enable in production:

```hcl
enable_market_worker        = true
market_worker_desired_count = 1
```

## Rollout

1. Merge `blackout-web` PR (process-role + worker routes + Dockerfile liveness).
2. Build/push ECR image with `deploy/market-worker.mjs`.
3. Apply `blackout-infra` Terraform (`enable_market_worker = true`).
4. Set web secret `PROCESS_ROLE` is overridden by ECS task env — no secret merge needed.
5. Verify: `GET /api/cron/socket-health` on web returns `mode: cluster_redis` with leaders held.
6. RTH: `socket-health` + `spx-evaluate` green.

## Local dev

Unchanged — no `PROCESS_ROLE` → `all` (single process, sockets on first market hit).

```bash
# Simulate split locally (two terminals):
PROCESS_ROLE=ingest node deploy/market-worker.mjs
PROCESS_ROLE=web DATA_SOCKETS_ENABLED=0 npm run dev
```
