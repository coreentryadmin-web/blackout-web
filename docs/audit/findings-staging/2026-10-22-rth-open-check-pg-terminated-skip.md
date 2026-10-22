> **kind:** FINDING

## RTH open-check false RED — Postgres "Connection terminated unexpectedly" from CI — FIXED

| **Status** | FIXED (PR pending) |
| --- | --- |

**Symptom:** `RTH open check` workflow failed on `main` @ `ae00300c` (2026-10-22 ~18:10 UTC) after deploy validation passed: `Postgres RTH checks: Connection terminated unexpectedly`.

**Root cause:** GitHub Actions can reach `DATABASE_PUBLIC_URL` briefly then lose the RDS/proxy session. `validate-deploy` already skipped `ECONNRESET` via `isPrivateDbUnreachableError`, but `rth-open-check` used the same classifier on `e.message` only — and **"Connection terminated unexpectedly"** was not in the pattern, so RTH-open hard-failed.

**Fix:** Extend `isPrivateDbUnreachableError` for terminated-connection messages; use `describeConnectError` in `rth-open-check` catch.

**Verify:** Re-run `RTH open check` workflow on `main` during RTH window — should skip Postgres writer checks with warning when CI cannot hold a connection, not exit 1.
