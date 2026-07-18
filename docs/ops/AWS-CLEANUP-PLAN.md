# AWS prep + codebase cleanup plan

**Sandbox repo:** `coreentryadmin-web/blackout-web-sandbox` → branch `blackout-web-sandbox`

**Prod repo:** `coreentryadmin-web/blackout-web` → `main` (**AWS ECS** — production)

**Infra repo:** [blackout-infra](https://github.com/coreentryadmin-web/blackout-infra) (Terraform)

---

## Do NOT rewrite the framework

**Keep Next.js 15 (App Router).** Speed comes from bundle size, caching, and infra — not ejecting Next.

For AWS: `output: "standalone"` + `deploy/Dockerfile` (same Next app, containerized).

---

## Phased execution

### Phase 0 — Measure
- [x] `npm run build` — route bundle sizes recorded on sandbox
- [x] `scripts/site-latency-audit.mjs` on staging (post-ECS)
- [x] Dead routes inventoried (grid, nights-watch removed)
- [x] Document env manifest for AWS Secrets Manager (`docs/ops/AWS-SECRETS-MANIFEST.md`)

### Phase 1 — AWS blockers
- [x] `next.config.mjs`: `output: "standalone"`
- [x] `deploy/Dockerfile` + `.dockerignore`
- [x] GitHub Action: ECR push (`ecr-push-staging.yml`, `ecr-push-production.yml`)
- [x] `docs/ops/AWS-MIGRATION-PLAN.md`

### Phase 2 — Safe dead code
- [x] Stale grid / nights-watch references
- [x] Orphan components deleted (~40 files)
- [x] Audit pile archived
- [x] `/vector` middleware protected
- [x] Dead CSS purged from `globals.css`
- [ ] Remaining duplicate fetch paths in FINDINGS.md (fix with tests as found)

### Phase 3 — Client bundle diet
- [x] Vector chart code-split
- [x] Thermal GexHeatmap `ssr:false`
- [ ] Audit Largo/Anthropic imports in client trees (ongoing guard)
- [x] Tailwind `content` includes `./src/features/**`

### Phase 4 — Folder structure ✅
- [x] `src/features/{spx,helix,thermal,nighthawk,largo,vector}/`
- [x] `docs/ONBOARDING.md` refreshed

### Phase 5 — Infra (`blackout-infra`) ✅ production
- [x] Staging + production: VPC, RDS+Proxy, ElastiCache, ALB, ECS, Secrets Manager
- [x] EventBridge crons → Lambda (31 jobs prod)
- [x] Cloudflare origin → ALB (prod cutover 2026-07)
- [ ] Wire CloudWatch alarms → Discord (`alarm_sns_topic_arns`)
- [ ] Auto-sync `REPLICA_COUNT` with ECS task count (manual today)

---

## Branch policy

| Repo / branch | Purpose |
|---------------|---------|
| **`blackout-web` → `main`** | **Production (AWS ECS).** Default target for hotfixes and verified merges. |
| **`blackout-web-sandbox` → `blackout-web-sandbox`** | Staging experiments — merge to prod only when explicitly requested. |
| **`blackout-infra`** | Terraform only |

---

## PR rules

1. One concern per commit/PR when possible
2. `npx tsc --noEmit` + `npm test` + `npm run build` for code changes
3. Log material findings in `docs/audit/FINDINGS.md`
4. Doc-only PRs: no deploy impact — still request human review when user asks
