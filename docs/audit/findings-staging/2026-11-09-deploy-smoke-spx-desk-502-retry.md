# Deploy smoke false RED on post-rollout SPX desk HTTP 502 — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |

## What broke

**Deploy smoke** on `main` @ `0dee31c5` (run `42550161810`) failed after public probes were green:

`✗ /api/market/spx/desk → unexpected HTTP 502`

Health and ready succeeded; the cron-authenticated desk probe hit a transient 502 (~2m after merge — typical draining-replica / cold `loadSpxDesk()` window).

## Fix

Treat 502/503/504/429 as `retry` in `evaluateSpxDeskSmoke()` and retry the desk probe in `gha-http-smoke.mjs` (default 8× / 5s) before failing deploy smoke.

## Verify

`npx tsx --test scripts/lib/gha-desk-smoke-eval.test.ts` GREEN.
