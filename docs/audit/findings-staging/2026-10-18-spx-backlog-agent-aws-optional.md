> **kind:** FINDING

## SPX backlog agent `collect-and-dispatch` hard-fails on invalid GHA AWS keys — FIXED

| **Status** | FIXED |
|------------|-------|

**Symptom:** `main` branch status showed `collect-and-dispatch` failure alongside deploy `smoke` — but the failing job was **SPX platform backlog agent** (scheduled), not `ops-auto-fix` (which was already green).

**Root cause:** `spx-platform-backlog-agent.yml` required valid `configure-aws-credentials` before the ops deferral probe could run.

**Fix:** Same optional-AWS + GitHub secret fallbacks pattern as `ops-auto-fix.yml`.
