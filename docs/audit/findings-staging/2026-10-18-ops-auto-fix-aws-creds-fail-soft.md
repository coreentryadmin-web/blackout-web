## 2026-10-18 — [FINDING, ops] ops-auto-fix dies on stale GitHub AWS keys before collect runs

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED (PR `fix/ops-auto-fix-aws-creds-fail-soft`) |
| **Severity** | P2 — ops pipeline blind during deploy failures |
| **Surface** | `.github/workflows/ops-auto-fix.yml` |

### Symptom

`collect-and-dispatch` on `main` failed at `Configure AWS credentials` with `InvalidClientTokenId`
when GitHub `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` were invalid. The job never reached
`scripts/ops-collect-action-items.mjs`, so deploy-smoke failures (e.g. production 503) did not
open `ops-auto-fix` issues or dispatch agents.

### Root cause

The workflow treated AWS credential configuration as a hard gate. `ops-collect` already supports
falling back to `CRON_SECRET` and `DATABASE_PUBLIC_URL` via `auditSecret` when Secrets Manager is
unavailable, but those env vars were not passed from GitHub secrets and the AWS step had no
`continue-on-error`.

### Fix

- `continue-on-error: true` on the AWS credentials step with a warning annotation.
- Pass `CRON_SECRET` and `DATABASE_PUBLIC_URL` into the collect step so collection can run when
  AWS keys are stale.

### Verify

Re-run **Ops auto-fix** workflow on `main` after merge; expect collect step to run even if AWS
step warns. Rotating GitHub AWS secrets remains an operator action for full Secrets Manager path.
