> **kind:** FINDING

# validate-deploy skipped off-hours `force=1` cache-warmer probes — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P2-validate-deploy-off-hours-warm |
| **Priority** | P2 |
| **Status** | FIXED |
| **PR** | fix/validate-deploy-skip-off-hours-warm |

## Symptom

`npm run validate:deploy` (§2b) always hit `/api/cron/desk-warm?force=1` when `CRON_SECRET` was present — including weekends and deep off-hours. Each Cloud Agent session uses a distinct egress IP, contributing to the measured 54-IP `force=1` storm on desk-warm (see `2026-09-05-desk-warm-weekend-force-storm.md`).

## Fix

Gate §2b on `isEtExtendedWarmHours()` — same window production warm crons use (weekday 4am–8pm ET). Post-deploy smoke still validates `/api/ready`, health, marketing gates, Postgres, sockets, etc.

## Regression

`src/validate-deploy-warm-gate.test.ts` — structural guard on `scripts/validate-deploy.mjs`.
