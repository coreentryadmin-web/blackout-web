> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Title** | Deploy smoke failed on cron-auth SPX desk 200 with price 0 (weekend) |
| **Status** | FIXED |

## Root cause

`gha-http-smoke.mjs` required `body.price > 0` when CI `CRON_SECRET` matched prod. Off-hours / weekend the desk honestly returns `200` with `price: 0` and `available: false` — not a broken deploy (run 42502809714, Sun 2026-11-08).

## Fix

`spxDeskCronSmokeVerdict()` treats authenticated JSON 200 without live spot as **degraded pass** (warn); still fails 5xx/404.
