> **kind:** FINDING

## Cron audit query false P0 on swing-discovery off-hours (8:25 PM ET)

| **Status** | FIXED (this PR) |
|------------|-----------------|
| **Detected** | run `42735522106` on `main` @ `1f445e92` |
| **Symptom** | `problems: swing-discovery` only — phase-anchored handshake, not RTH market-hours stale |
| **Root cause** | CI treated all `problem_keys` as fail; 36h registry ceiling vs weekly phase gap; no between-phase suppress |
| **Fix** | `cronAuditFailKeys` (fail handshake problems only in cash RTH + always `rth_stale_keys`); swing handshake ceiling + phase-gap idle in `evaluateJob` |
| **Verify** | `node --test scripts/lib/cron-audit-watchdog-eval.test.mjs`; `npx tsx --test src/lib/admin-cron-health.test.ts` |
