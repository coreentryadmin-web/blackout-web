# CI verify flake: polygon-largo-cancellation second test

> **kind:** FINDING

| **Status** | FIXED (pending merge) |

## Symptom

`main` verify failed (run 41349118735 @ `7f5519c17`):  
`not ok 10745 - fetchPolygonTickerDetails: aborting the caller's signal...`  
Assertion: request never reached local test server (`fetch failed`).

## Root cause

Two sequential tests share one HTTP server. After the first abort, undici can open a
replacement keep-alive socket (documented in `api-tracked-fetch.test.ts`). That stray
connection races the second test and sometimes prevents a fresh accept / causes immediate
`fetch failed` on the next call.

## Fix

`settleServerAfterAbortTest()` destroys tracked sockets and brief-settles between tests.

## Verify

30 consecutive runs of `polygon-largo-cancellation.test.ts` — 0 failures.
