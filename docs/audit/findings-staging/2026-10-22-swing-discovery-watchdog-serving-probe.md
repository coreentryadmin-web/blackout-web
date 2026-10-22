> **kind:** FINDING

## Cron audit query failed on `swing-discovery` while serving lane still live

| **Status** | FIXED (PR pending) |
|------------|-------------------|

**Symptom:** `main` @ `e54926506` — scheduled **Cron audit query** reported `problems: swing-discovery` (2026-10-22 ~16:20Z, RTH).

**Root cause:** Phase-anchored `swing-discovery` can log a **failed** `cron_job_runs` handshake (ALB/route timeout mid whole-market scan) while `swing:serving:latest:v1` still carries **today's** session snapshot for the member horizons lane. `TARGET_FRESH_OVERRIDE_KEYS` probed writer targets only for `stale` / `market_hours_stale`, not `failed`, and `swing-discovery` had no probe.

**Fix:** Add `swing-discovery` writer-target probe (`readSwingServingSnapshot`, same `sessionDay` as today, `asOf` ≤ 8h). Extend override loop to run on `failed` when the probe reports fresh.

**Verify:** `node scripts/cron-audit-query.mjs` green during RTH when serving snapshot is current; admin cron health shows "Target fresh" after a benign failed handshake.
