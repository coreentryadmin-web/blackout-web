# RTH open-check false RED on transient Postgres drop

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (pending merge) |
| **CI** | `open-check` on `main` @ `ae00300c` |

## Symptom

`RTH open check` failed with `Postgres RTH checks: Connection terminated unexpectedly` while `validate:deploy` passed (HTTP smoke green). Prod was healthy; GHA lost the RDS proxy mid-query.

## Fix

- Classify `connection terminated` as unreachable/transient in `isPrivateDbUnreachableError` (shared audit helper).
- `rth-open-check.mjs`: use `describeConnectError` in the catch path; skip writer checks with warning instead of failing CI.
- Skip uw-socket Railway log grep in GitHub Actions (no `rg` / no Railway CLI); use `grep -E` elsewhere.

## Verify

- `node --test scripts/pg-audit.test.mjs`
