## 2026-11-01 — [FINDING, P2 CI] `polygon-largo-cancellation.test.ts` flaky under full parallel verify — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR pending) |
| **Found by** | CI `verify` on `main` @ `7f5519c17`, run `41349118735` |
| **Scope** | `src/lib/providers/polygon-largo-cancellation.test.ts` |

### Root cause

`fetchPolygonTickerDetails` cancellation test waits only **2s** for a local TCP connection.
During full-suite CI, `acquirePolygonSlot` can queue behind other tests' Polygon traffic longer
than 2s, so the harness logged `fetch failed` and failed with "the request must actually reach the
server" — unrelated to the dark-pool commit on the same SHA.

### Fix

Raise connection wait in CI (20s), reset polygon circuit breaker before each test in the file.

### Regression guard

Existing tests in the same file; run `npx tsx --test src/lib/providers/polygon-largo-cancellation.test.ts`.
