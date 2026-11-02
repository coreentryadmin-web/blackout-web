# RTH deep audit false P0 SPX oracle after close — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## What broke

`RTH deep audit` on `8f9e0d4` failed `Full-site deep audit` P0: desk SPX 7552.74 vs Polygon 7541.40 (Δ 11.34) at **17:30 ET** (market closed).

## Root cause

`full-site-deep-audit.mjs` always compared platform snapshot to Polygon **index snapshot value** with a flat **$5** tolerance. After the close, that reference diverges from the desk snapshot while still being a small % move — data-validator already uses **prev-close + % tolerance** off RTH.

## Fix

Extract `spxOracleVerdict` (live 0.3% RTH, prev-close 1.5% off-hours) and gate oracle fetches on Polygon `marketstatus/now`.

## Verify

- `node --test scripts/audit/lib/spx-oracle-audit.test.mjs` (includes the 11.34pt / 7541 case)
