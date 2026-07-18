# AWS migration plan — blackout-web on ECS Fargate

**Status (2026-07-18):** **Production cutover complete.** `blackouttrades.com` runs on **ECS Fargate**
behind Cloudflare → ALB. EventBridge crons are **enabled** (31 jobs). Railway is
**decommissioned** for prod app + cron triggers; `railway.*.toml` files remain as the schedule
catalog for `blackout-infra/scripts/sync-cron-schedules.mjs`.

**Infra repo:** [blackout-infra](https://github.com/coreentryadmin-web/blackout-infra)

**Secrets manifest:** `docs/ops/AWS-SECRETS-MANIFEST.md`

**Ops runbook:** `blackout-infra/docs/ops/PROD-AWS-MIGRATION-RUNBOOK.md` (historical phases + ongoing ops)

**CDN:** **Cloudflare** in front of ALB — do not add CloudFront.

---

## Current production topology

| Layer | Resource |
|-------|----------|
| Edge | Cloudflare (DNS, WAF, Transform Rules / CSP, cache) |
| Origin | ALB → ECS `blackout-production-web` (autoscale 8–15 tasks, 2 vCPU / 4 GB) |
| Ingest | ECS `blackout-production-market-worker` (1 task) — upstream UW/Polygon WS |
| Database | RDS Postgres 16 Multi-AZ + RDS Proxy |
| Cache | ElastiCache Redis 7 (2 nodes, failover) |
| Crons | EventBridge → Lambda `blackout-production-hit-cron` → `/api/cron/*` |
| CI/CD | `ecr-push-production.yml` on `main` → ECR → ECS roll → CF purge |

---

## Phase history (all complete for prod)

| Phase | Deliverable | Status |
|-------|-------------|--------|
| 1 | Standalone Docker + ECR CI | ✅ |
| 2 | Staging stack (RDS, Redis, ALB, ECS) | ✅ |
| 3 | Prod RDS data migration from Railway | ✅ |
| 4 | Cloudflare origin → ALB, EventBridge crons on | ✅ |
| 5 | Railway scale-down / archive | ✅ (app); legacy TOMLs kept for schedule sync |

---

## Staging

Staging runs on **`blackout-web-sandbox`** → ECS `blackout-staging-web` at
`https://staging.blackouttrades.com`. See `docs/ops/STAGING-CONNECT.md`.

---

## Env manifest (Secrets Manager)

Same keys as historical Railway `blackout-web` — see `docs/ops/AWS-SECRETS-MANIFEST.md`. Minimum for a live desk:

- `DATABASE_URL`, `REDIS_URL` (RDS Proxy + ElastiCache endpoints — Terraform-seeded, do not overwrite from exports)
- `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `UW_API_KEY`, `POLYGON_API_KEY` (or `MASSIVE_API_KEY`)
- `CRON_SECRET`, `WHOP_*`, `ANTHROPIC_API_KEY`
- `REPLICA_COUNT`, `PG_POOL_MAX` — must track live web task count

---

## Non-goals (unchanged)

- EKS / raw EC2 worker fleet
- Clerk → Cognito
- CloudFront alongside Cloudflare
- Microservices split (modular monolith + horizontal scale)

---

## Legacy Railway artifacts (do not use for prod)

- `scripts/railway-*.mjs`, `.github/workflows/railway-*.yml` — retained for reference only
- `npm run validate:railway-crons` — validates TOML ↔ registry sync, not Railway provisioning
- `docs/ops/RAILWAY-CRON-SCHEDULES.md` — **schedule semantics** (UTC); authoritative for EventBridge expressions after sync
