# swing-discovery watchdog false P1 during intraday RTH — FIXED

> **kind:** FINDING

| **Status** | FIXED |

## What broke

RTH deep audit on `main` @ `0ba380023` (run `42897223779`, Tue 15:38 ET) flagged:

- `cron-watchdog → problems: swing-discovery`
- Full-site deep audit P1 `[crons] STALE-swing-discovery`

`swingDiscoveryAwaitingPhaseSuppress()` required same-day POST_CLOSE satisfied before suppressing **any** active phase. During POWER_HOUR (3:00–4:00 PM ET), POST_CLOSE has not run yet by design — stale/failed handshakes were never suppressed.

## Fix

- **#7898 (merged):** intraday phase windows suppress without POST_CLOSE; OVERNIGHT still requires POST_CLOSE `done`.
- **#7908 (follow-up):** inter-phase gaps on trading days suppress as idle (discovery not scheduled between windows).

## Verify

`npx tsx --test src/lib/swing/discovery-cron-health.test.ts`

Post-deploy: `npm run validate:deploy`; RTH `query` / `audit` should not list `swing-discovery` during POWER_HOUR or inter-phase gaps unless a failure is within the 90m grace window.
