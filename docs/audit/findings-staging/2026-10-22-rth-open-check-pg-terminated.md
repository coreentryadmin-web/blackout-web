> **kind:** FINDING

## RTH open check failed on transient Postgres disconnect

| **Status** | FIXED (PR pending) |
|------------|-------------------|

**Symptom:** `rth-open-check.yml` / `open-check` red on `main` @ `ae00300c` — `Postgres RTH checks: Connection terminated unexpectedly` while HTTP deploy validation was GREEN.

**Root cause:** Mid-query RDS/proxy drops were not classified as unreachable-network errors (unlike `ECONNRESET`), so GHA hard-failed instead of skipping writer checks like `validate-deploy` / `cron-audit-query`.

**Fix:** Extend `isPrivateDbUnreachableError`, use `describeConnectError` in `rth-open-check.mjs`, skip when `isPrivateVpcDbUrl(dbUrl)`.
