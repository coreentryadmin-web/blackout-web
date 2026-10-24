# Cron audit RED — swing-discovery transient failed handshake

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## Symptom

`main@e54926506` **Cron audit query** failed RTH with `problems: swing-discovery` (not zerodte-warm).

## Root cause

`swing-discovery` logs `cron_job_runs` only after the inline phase scan finishes. A timeout/throw marks the **last** row `failed` even when the Redis serving snapshot from an earlier successful phase remains fresh for members. The watchdog treats any `failed` row as a problem; unlike warmers, swing-discovery had no writer-target override.

## Fix

- Probe `readSwingServingSnapshot()` in `probeWriterTargetFresh("swing-discovery")` and add swing-discovery to `TARGET_FRESH_OVERRIDE_KEYS`, including `failed` handshakes when the snapshot is fresh.
- Downgrade to `warning` when a live `running` phase claim is held (scan in flight).

## Verify

`npx tsx --test src/lib/cron-writer-target-fresh.test.ts src/lib/admin-cron-health.test.ts`; next `query` CI on `main` after deploy.
