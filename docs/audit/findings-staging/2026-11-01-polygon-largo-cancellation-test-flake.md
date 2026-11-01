# 2026-11-01 verify red — polygon-largo cancellation test connection wait

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 CI |

## What broke

`verify` on `7f5519c1` failed: `fetchPolygonTickerDetails: aborting the caller's signal terminates the real underlying connection` — `waitForNextConnection` timed out at 2000ms while the shared Polygon limiter had not yet admitted the fetch (full-suite load ~test 10745).

## Fix

Reset circuit state before each case; raise connection wait to 25s (queue budget scale).

## Verify

`npx tsx --test src/lib/providers/polygon-largo-cancellation.test.ts`
