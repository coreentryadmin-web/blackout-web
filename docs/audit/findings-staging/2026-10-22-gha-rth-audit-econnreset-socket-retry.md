> **kind:** FINDING

## RTH deep audit (`audit` job) failed on transient infra noise

| **Status** | FIXED (PR pending) |
|------------|-------------------|

**Symptom:** `rth-deep-audit.yml` job `audit` red on `main` @ `7b0f46b0` — `socket-health: HTTP 503` and `postgres: read ECONNRESET`.

**Root cause:** `gha-rth-audit.mjs` Postgres catch regex omitted `ECONNRESET` (unlike shared `isPrivateDbUnreachableError`). `socket-health` was a single fetch with no retry (unlike `rth-open-check` / `probeOptionsSocketWithRetries`).

**Fix:** Align Postgres with `describeConnectError` + `isPrivateDbUnreachableError` + private VPC skip; probe socket-health with retries.
