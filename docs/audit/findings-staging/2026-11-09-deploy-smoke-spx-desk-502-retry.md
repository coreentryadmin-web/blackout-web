# Deploy smoke: transient 502 on `/api/market/spx/desk` during ECS roll

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **When** | 2026-11-09 ~02:05–02:20 UTC (Sun evening ET) |
| **CI** | Deploy smoke runs 42548713697, 42550161810 (`head` debd928, 0dee31c5) |

## Symptom

`scripts/gha-http-smoke.mjs` failed after `gha-wait-deploy` already saw healthy `/api/health`:

```text
✗ /api/market/spx/desk → unexpected HTTP 502
```

Meridian-only merges; no desk code change on those SHAs.

## Root cause

Rolling ECS deploy: light routes pass health, but the merged SPX desk payload can still hit a draining task or CF/ALB edge for one shot. Smoke used a single unauthenticated-style `fetch` (no 5xx retry), while other audit harnesses already use `fetchRetry` for desk.

## Fix

`fetchJsonDesk()` in `scripts/gha-http-smoke.mjs` wraps the cron-authed desk probe with `fetchRetry` (default 4 retries, 2s stepped backoff). Verdict logic unchanged in `evaluateSpxDeskSmoke`.

## Verification

- `npx tsx --test scripts/lib/gha-desk-smoke-eval.test.ts`
- Next green deploy-smoke on `main` after merge
