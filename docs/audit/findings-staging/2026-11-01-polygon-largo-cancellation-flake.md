# verify RED — polygon-largo cancellation test connection wait flake

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|
| **Severity** | P2 — CI flake |
| **Discovered** | verify run 41349118735 on `main@7f5519c1` |

## Symptom

Full `npm test` failed: `fetchPolygonTickerDetails: aborting the caller's signal...` — assertion `the request must actually reach the server` after exactly ~2003ms.

## Root cause

Under loaded CI, TCP connection to the hanging test server can exceed the fixed 2s poll window; isolated file run passes.

## Fix

Event-driven `waitForNextConnection` + 8s budget (both cancellation tests).

## Evidence

CI failure at line 113; local isolated run green.
