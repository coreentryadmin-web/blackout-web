# verify RED on polygon-largo abort wiring under CI load — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## What broke

`verify` on `7f5519c` failed: `fetchPolygonTickerDetails: aborting the caller's signal terminates the real underlying connection` — connection wait timed out at 2s under full-suite GHA load (`fetch failed` before TCP opened).

## Root cause

Test assumes polygon admission + TCP connect within 2s; contended global polygon limiter during ~15k subtests can exceed that on CI only.

## Fix

Use `ABORT_WIRE_CONNECT_WAIT_MS` default 15s when `CI=1` (override via `POLYGON_ABORT_WIRE_CONNECT_WAIT_MS`).

## Verify

- `node --import tsx --test src/lib/providers/polygon-largo-cancellation.test.ts`
