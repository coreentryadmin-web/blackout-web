# gha-rth-audit false RED on transient socket-health 503 + Postgres ECONNRESET

> **kind:** FINDING

| **Status** | FIXED |
|------------|-------|
| **When** | 2026-10-22 RTH deep audit run 39836457065 on `main` @ `7b0f46b` |
| **Symptom** | Job `audit` failed: `socket-health → HTTP 503`, `postgres: read ECONNRESET` |
| **Root cause** | `scripts/gha-rth-audit.mjs` treated a single socket-health fetch as authoritative (no retries — unlike `rth-open-check.mjs`) and did not classify `ECONNRESET` as unreachable-network skip (unlike `rth-open-check` / `pg-audit.isPrivateDbUnreachableError`). |
| **Fix** | Socket probe uses `probeOptionsSocketWithRetries`; Postgres catch uses `describeConnectError` + `isPrivateDbUnreachableError`. |
| **Verify** | Next scheduled RTH deep audit GREEN; or `node scripts/gha-rth-audit.mjs` from GHA with prod secrets during RTH. |
