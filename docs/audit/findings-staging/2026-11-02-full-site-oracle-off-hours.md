# Full-site deep audit SPX oracle false P0 off-hours — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |

## What broke

Scheduled **RTH deep audit** on `main` @ `8f9e0d4d` (run `41537722853`) failed with P0:

`[oracle] SPX: desk 7552.74 vs Polygon 7541.40 (Δ 11.34)`

Run was **Mon 17:30 ET** — market closed. `scripts/full-site-deep-audit.mjs` always compared platform snapshot SPX to Polygon index snapshot; off-hours that mixes live-ish desk spot with a different Polygon field and false-fails. `data-validator.mjs` already uses live snapshot only when `marketstatus/now` is `open`.

## Fix

Gate the oracle block on Polygon `market === "open"`; otherwise record an explicit skip pass.

## Verify

`npx tsx --test scripts/full-site-deep-audit.test.mjs` GREEN.
