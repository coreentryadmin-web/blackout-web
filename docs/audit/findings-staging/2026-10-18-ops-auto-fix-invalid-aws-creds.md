# Ops auto-fix hard-fails when GitHub AWS secrets are invalid — 2026-10-18

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 — ops pipeline blind during cred rotation |
| **Surface** | `.github/workflows/ops-auto-fix.yml` |

## Symptom

`collect-and-dispatch` failed before `ops:collect` ran:

```
The security token included in the request is invalid.
```

## Root cause

`configure-aws-credentials` is a hard gate. When `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are
stale, the job exits and never reaches the collector — even though `auditSecret()` can fall back to
`secrets.CRON_SECRET` / `secrets.DATABASE_PUBLIC_URL` if those env vars are injected.

## Fix

- `continue-on-error: true` on AWS configure + workflow warning annotation.
- Pass `CRON_SECRET` and `DATABASE_PUBLIC_URL` into the collect step env.
