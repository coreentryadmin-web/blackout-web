# swing-discovery cron audit query failure — maxDuration + health grace

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (pending merge) |
| **Area** | Night Hawk Swings / cron health |
| **CI** | `query` on `main` @ `e54926506` — `problems: swing-discovery` |

## Symptom

Cron audit `query` failed via HTTP watchdog: `problems: swing-discovery`, `error_spike: none`. Ops-auto-fix issue #6564 same fingerprint.

## Root cause

`swing-discovery` runs the whole-market scan **inline** (not `after()`) but `maxDuration` was **120s** while `railway.swing-discovery.toml` / hit-cron allows **300s**. Phase scans that run 2–4+ minutes were killed by the platform mid-request → `ok: false` + `claim_released` → watchdog `failed`/`stale` until the next successful phase completion.

## Fix

1. Raise route `maxDuration` to **300**; align `SWING_DISCOVERY_SCAN_MAX_MS` in `discovery-claim.ts`.
2. Register `schedule_cron_utc: "*/30 * * * 1-5"` for off-schedule idle suppression parity.
3. `admin-cron-health`: in-flight grace when phase Redis claim is `running`; downgrade recent `claim_released` failures inside an active phase to `warning`.

## Verify

- `node --import tsx --test src/app/api/cron/swing-discovery/route.test.ts`
- `node --import tsx --test src/lib/admin-cron-health.test.ts`
- Post-deploy: `npm run validate:cron` green; ops:collect zero watchdog items for swing-discovery.
