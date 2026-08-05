# AWS Secrets Manager manifest — blackout-web on ECS

Manages the app secret (`blackout-{staging|production}/app/env` JSON) in AWS
Secrets Manager. **Never commit real values.**

## Architecture

- Terraform creates the secret with 9 base keys (DB, Redis, Node config).
- `lifecycle { ignore_changes = [secret_string] }` prevents `terraform apply`
  from reverting keys added out-of-band.
- `inject_all_app_secret_keys = true` means ECS reads every key from the live
  secret JSON — no Terraform changes needed to add new keys.
- `NEXT_PUBLIC_*` vars are baked at **Docker build time**, not read from Secrets
  Manager at runtime. Override via `--build-arg` in the ECR build workflow.

## Terraform-managed keys (auto-populated)

| Key | Source |
|-----|--------|
| `DATABASE_URL` | RDS Proxy endpoint |
| `DATABASE_SSL_STRICT` | **Set `1` in production** — enables `rejectUnauthorized` on the Postgres TLS client (`src/lib/db.ts`). Accepts `1`/`true`/`yes`. Default/unset = verify off (legacy). Required now that traffic is VPC → RDS Proxy with AWS CA. Pair with `DATABASE_SSL` unset (SSL on) — never set `DATABASE_SSL=0` in prod. |
| `REDIS_URL` | ElastiCache endpoint |
| `PORT` | `3000` |
| `HOSTNAME` | `0.0.0.0` |
| `NODE_ENV` | `production` |
| `REPLICA_COUNT` | `ecs_desired_count` |
| `CRON_SECRET` | Auto-generated |
| `PGBOUNCER_DEFAULT_POOL_SIZE` | tfvars |
| `PG_POOL_MAX` | tfvars |

## Required for production (manual — add via merge script)

### Critical (app won't start / auth broken)

| Key | Purpose |
|-----|---------|
| `CLERK_SECRET_KEY` | Server-side auth |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Also set as Docker build-arg |
| `PG_STATEMENT_TIMEOUT_MS` | Query safety net (`30000`) |

### High (features broken without these)

| Key | Purpose |
|-----|---------|
| `UW_API_KEY` | Options flow / GEX / walls |
| `POLYGON_API_KEY` | Market data + Benzinga news |
| `WHOP_API_KEY` | Billing / tier checks |
| `WHOP_WEBHOOK_SECRET` | Billing webhooks |
| `ANTHROPIC_API_KEY` | Largo / Night Hawk AI |
| `WHOP_FREE_PLAN_ID` | Tier engine |
| `WHOP_PRO_PLAN_ID` | Tier engine |
| `WHOP_PREMIUM_PLAN_ID` | Tier engine |
| `WHOP_ELITE_PLAN_ID` | Tier engine |
| `ADMIN_EMAILS` | Admin role bypass |

### Medium (ops / nice-to-have)

| Key | Purpose |
|-----|---------|
| `DISCORD_OPS_WEBHOOK_URL` | Ops alerts |
| `DISCORD_TRADE_WEBHOOK_URL` | Trade notifications |
| `DISCORD_THERMAL_WEBHOOK_URL` | Thermal triple-desk PNG → designated Discord channel (`/api/cron/thermal-discord` 15m RTH + shift leaders; `?breach_only=1` poller 5m RTH for SPY/SPX/QQQ wall/flip alerts; ~4:05 PM ET session recap) |
| `DISCORD_HELIX_WEBHOOK_URL` | HELIX community flow embeds + digests (`#blackout-helix`; live + `/api/cron/helix-discord-digest`) |
| `HELIX_DISCORD_ALERTS` | Opt-in `1`/`true` — live HELIX flow embeds (≥$500K · fill <$10 · ≤30 DTE) on persist + 15m RTH digests; uses `DISCORD_HELIX_WEBHOOK_URL` |
| `HELIX_DISCORD_LIVE_RTH_ONLY` | Default `true` — suppress live HELIX WS/persist pings outside cash RTH (digests use `HELIX_DISCORD_DIGEST_RTH_ONLY`) |
| `DISCORD_DARKPOOL_WEBHOOK_URL` | Dark pool block alerts + 15m top-blocks digest (`#blackout-darkpool`; `/api/cron/darkpool-discord` + WS ingest) |
| `DARKPOOL_DISCORD_ALERTS` | Opt-in `1`/`true` — live blocks ≥$5M (override via `DARKPOOL_DISCORD_MIN_PREMIUM`) on `off_lit_trades` + 2m cron scan |
| `DARKPOOL_DISCORD_LIVE_RTH_ONLY` | Default `true` — suppress live dark pool WS/cron pings outside cash RTH (route cron uses `DARKPOOL_DISCORD_RTH_ONLY`) |
| `DISCORD_BURST_WINDOW_SEC` | Optional — collapse rapid alerts per ticker into one embed (default **240**, range 60–600) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Push notifications |
| `VAPID_PRIVATE_KEY` | Push notifications |
| `CF_ZONE_ID` | Cache purge on deploy |
| `CF_API_TOKEN` | Cache purge on deploy |
| `GOOGLE_SITE_VERIFICATION` | Google Search Console HTML-tag verification |
| `BING_SITE_VERIFICATION` | Bing Webmaster HTML-tag verification |
| `NEXT_PUBLIC_SITE_URL` | `https://blackouttrades.com` |
| `CRON_TARGET_BASE_URL` | EventBridge Lambda target |

### Optional

| Key | Purpose |
|-----|---------|
| `BRAVE_SEARCH_API_KEY` | BIE web search |
| `PERPLEXITY_API_KEY` | BIE deep research |
| `INTEL_URL` | External intel feed |
| `SENTRY_DSN` | Error tracking |
| `ZERODTE_MAX_CONCURRENT` | Max simultaneously OPEN 0DTE plans (code default **100**; `0` = unlimited). Quality gates + session stop/loss floors remain the risk brake — do not lower this to invent desk scarcity. |

## Docker build-arg overrides (production vs staging defaults)

The Dockerfile defaults to staging values. Production builds must override:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SITE_URL=https://blackouttrades.com \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_... \
  --build-arg NEXT_PUBLIC_CLERK_IS_SATELLITE=false \
  --build-arg NEXT_PUBLIC_CLERK_PROXY_URL="" \
  --build-arg NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in \
  --build-arg NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up \
  --build-arg NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS=https://blackouttrades.com \
  --build-arg NEXT_PUBLIC_AUTH_PROVIDER=clerk \
  --build-arg AUTH_PROVIDER=clerk \
  -f deploy/Dockerfile .
```

## Merge env file into Secrets Manager

```bash
# 1. Copy production.env.example → production.env and fill in values
cp production.env.example production.env

# 2. Dry run (shows what would change, values redacted)
node scripts/merge-app-secret.mjs \
  --secret-name blackout-production/app/env \
  --env-file ./production.env \
  --dry-run

# 3. Apply
node scripts/merge-app-secret.mjs \
  --secret-name blackout-production/app/env \
  --env-file ./production.env

# 4. Force ECS to pick up new secrets
aws ecs update-service \
  --cluster blackout-production-cluster \
  --service blackout-production-web \
  --force-new-deployment

# Also restart market worker if running
aws ecs update-service \
  --cluster blackout-production-cluster \
  --service blackout-production-market-worker \
  --force-new-deployment
```

## ECS container environment (set by Terraform, not secrets)

These are plain-text env vars in the ECS task definition, not in Secrets Manager:

| Key | Web Service | Market Worker |
|-----|-------------|---------------|
| `PROCESS_ROLE` | `web` | `ingest` |
| `DATA_SOCKETS_ENABLED` | `0` | `1` |
| `EAGER_DATA_SOCKETS` | — | `1` |

## Validate

```bash
CRON_TARGET_BASE_URL=https://blackouttrades.com npm run validate:deploy
```
