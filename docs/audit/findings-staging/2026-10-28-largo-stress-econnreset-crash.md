# Largo stress nightly crash on ECONNRESET — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## What broke

Scheduled `Largo stress nightly` on `734b7f94` crashed mid-sweep after several Cloudflare `429` SKIPs with uncaught `TypeError: fetch failed` / `read ECONNRESET`, failing the `largo-stress` check.

## Root cause

`askLive` used `fetchRetry` with only one retry and no catch — exhausted transport errors propagated out of the worker loop and aborted the entire run.

## Fix

- Catch fetch failures in `askLive`, return transport status `0`.
- Retry `429` and transport `0` in `askLiveThrottleAware`; raise `fetchRetry` retries to 4.
- Worker try/catch as backstop; score transport as SKIP (excluded from quality tally).

## Verify

- `node --import tsx --test scripts/largo-stress-transport.test.mjs`
- Next nightly run completes even under CF throttle bursts.
