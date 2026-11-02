# RTH deep audit false P0 SPX oracle after close — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
| --- | --- |

## What broke

Scheduled **RTH deep audit** run [41537722853](https://github.com/coreentryadmin-web/blackout-web/actions/runs/41537722853) @ `8f9e0d4d` (17:30 ET): P0 `[oracle] SPX: desk 7552.74 vs Polygon 7541.40 (Δ 11.34)`. Prod `/api/health` 200; 38/39 deep-audit checks passed.

## Root cause

`full-site-deep-audit.mjs` always compared platform snapshot SPX `price` to Polygon index snapshot after the 4:30 PM ET scheduled run. Post-close, desk/snapshot can show extended or last prints while Polygon `value`/`session.close` stays on the regular-session settle — not a user-visible correctness bug.

## Fix

Skip the Polygon oracle cross-check when `/api/market/spx/desk` reports `market_open !== true`.

## Verify

`node --test --import tsx scripts/full-site-deep-audit.test.mjs`
