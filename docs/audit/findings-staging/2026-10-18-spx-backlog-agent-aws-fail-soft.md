## 2026-10-18 — [FINDING, ops] SPX backlog agent hard-fails on invalid GitHub AWS keys

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED (PR `fix/spx-backlog-agent-aws-fail-soft`) |
| **Severity** | P2 |
| **Surface** | `.github/workflows/spx-platform-backlog-agent.yml` |

### Symptom

Commit `baec3f755` reported a failed check named `collect-and-dispatch` — that job belongs to
**SPX platform backlog agent**, not Ops auto-fix. AWS `configure-aws-credentials` exited hard
on invalid security token (same stale GitHub AWS keys as ops-auto-fix).

### Fix

Mirror ops-auto-fix: `continue-on-error` on AWS step; pass `CRON_SECRET` / `DATABASE_PUBLIC_URL`
into the prod ops gate step so `ops-collect-action-items.mjs` can run without Secrets Manager.
