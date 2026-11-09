# RTH deep audit false fail off-hours (SPX spot 0 + swing-discovery POST_CLOSE)

> **kind:** FINDING

| **Status** | FIXED |

## Symptom

Scheduled **RTH deep audit** run `42718407755` @ Mon 18:12 ET: `audit` failed on full-site P0 `[spx-desk] spot missing or invalid: 0` (desk `available:false`) and cron-watchdog `swing-discovery` stale (POST_CLOSE window still open).

## Fix

- `full-site-deep-audit.mjs`: skip P0 spot when desk honestly unavailable or off-hours (data-validator parity).
- `admin-cron-health.ts`: during active POST_CLOSE phase, downgrade stale/failed swing-discovery handshake to `warning` (watchdog ignores; scan still due before 20:00 ET).
