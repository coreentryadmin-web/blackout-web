> **kind:** FINDING

## Ops auto-fix blocked on invalid AWS creds; sustained 503 only P2 — FIXED

| **Status** | FIXED (PR pending) |
|------------|-------------------|

**What was broken:** Production returned sustained Cloudflare/origin 503 (~17:33 UTC Oct 18). Deploy smoke failed on `gha-wait-deploy.mjs`. `ops-auto-fix` `collect-and-dispatch` never reached `ops:collect` because `aws-actions/configure-aws-credentials` failed with invalid GitHub `AWS_*` secrets. When collect did run, watchdog-only 503 classified as P2 (`isTransientOriginError`), so `ops:collect` exited 0 and did not dispatch an agent.

**Fix:** `ops-auto-fix.yml` — AWS configure step `continue-on-error: true` with warning. `ops-collect-action-items.mjs` — five-attempt `/api/health` probe emits P0 `origin:health` before cron watchdog.

**Verify:** During outage, `npm run ops:collect` exits 1 with P0 `origin:health`. After origin recovery, item clears. Re-run failed Deploy smoke workflow on green main.
