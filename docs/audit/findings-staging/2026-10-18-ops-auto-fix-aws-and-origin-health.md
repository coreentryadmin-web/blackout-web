# Ops auto-fix blocked on invalid AWS creds; origin 503 only P2

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P1 |
| **Area** | ops / CI |

## Symptom

During production origin outage (2026-10-18 ~17:18Z+), `Deploy smoke` failed on `gha-wait-deploy.mjs` (expected). `Ops auto-fix` `collect-and-dispatch` also failed before collect: `aws-actions/configure-aws-credentials` — invalid security token. `ops:collect` only emitted P2 `watchdog:http` for HTTP 503, so exit code stayed 0 and no agent dispatch.

## Fix

- `ops-auto-fix.yml`: `continue-on-error` on AWS configure + warning when creds invalid (collect uses `CRON_SECRET` / `DATABASE_PUBLIC_URL` GitHub fallbacks).
- `ops-collect-action-items.mjs`: `originHealthItems()` — sustained `/api/health` failure → P0 `origin:health` (exit 1, dispatch eligible).

## Evidence

- Deploy smoke run 39150061262: 12/12 health poll failures.
- Ops auto-fix 39150544495: AWS `InvalidClientTokenId`.
- Live: `curl` `/api/health` → 503 (Cloudflare origin unreachable).
