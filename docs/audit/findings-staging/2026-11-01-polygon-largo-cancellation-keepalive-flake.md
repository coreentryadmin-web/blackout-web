# polygon-largo-cancellation keep-alive CI flake — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
| --- | --- |

## What broke

`verify` on `main` @ `7f5519c17`: `fetchPolygonTickerDetails: aborting the caller's signal terminates the real underlying connection` failed with *"the request must actually reach the server for this test to prove anything"* after exactly 2000ms. Log also showed `/v3/reference/tickers/AAPL failed: fetch failed`. Unrelated dark-pool merge (#7277); first subtest in the same file passed.

## Root cause

The harness waited for a **new** TCP `connection` event before aborting. Node's fetch (undici) may **reuse keep-alive** to the mock server on the second subtest, so the HTTP request reached the server but no second `connection` fired — race/time-out flake under CI load.

## Fix

Track `req.socket` on each incoming HTTP `request` instead of counting `connection` events only.

## Verify

`npx tsx --test src/lib/providers/polygon-largo-cancellation.test.ts` — both subtests pass; re-run 5× locally.
