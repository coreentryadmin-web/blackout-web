# polygon-largo-cancellation CI flake on verify — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |

## What broke

`verify` on `main` @ `7f5519c17` failed subtest
`fetchPolygonTickerDetails: aborting the caller's signal terminates the real underlying connection`
with `the request must actually reach the server for this test to prove anything` — duration ~2003ms,
i.e. the old 2s poll loop never observed the TCP connection under a loaded CI runner (~31min into the suite).

## Root cause

`waitForNextConnection` used 2ms `setTimeout` polling only. Under event-loop starvation late in the
full `npm test` matrix, `fetch()` could be scheduled after the 2s deadline even though abort wiring is fine.

## Fix

Event-driven `server.on("connection")` wait plus `CONNECTION_WAIT_MS = 10_000` in
`polygon-largo-cancellation.test.ts`.

## Verify

`npx tsx --test src/lib/providers/polygon-largo-cancellation.test.ts` GREEN locally.
