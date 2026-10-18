> **kind:** FINDING

## Ops auto-fix hard-fails on invalid AWS creds; collect missed full prod outage — FIXED

| **Status** | FIXED (workflow + public health probe) |
|------------|----------------------------------------|

**Symptom:** `main` CI: `collect-and-dispatch` failed at `configure-aws-credentials` (“security token invalid”); `smoke` failed because `/api/health` stayed 503.

**Root cause:** `ops-auto-fix.yml` required valid AWS keys before `ops-collect-action-items.mjs` ran. Invalid/stale `AWS_ACCESS_KEY_ID` blocked the job entirely. Collect also had no unauthenticated health probe, so even a manual collect without `CRON_SECRET` could miss a total origin outage.

**Fix:** AWS configure step is `continue-on-error` with env cleared on failure; collect receives `CRON_SECRET` / `DATABASE_PUBLIC_URL` from GitHub secrets. `publicHealthItems()` pages P0 on sustained `/api/health` failure.

**Verify:** `node scripts/ops-collect-action-items.mjs` while prod is 503 → `prod:health-down` P0 item.
