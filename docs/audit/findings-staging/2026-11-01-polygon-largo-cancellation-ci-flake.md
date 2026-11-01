## 2026-11-01 — [FINDING] verify flake: polygon-largo cancellation harness misses TCP under CI load — FIXED

> **kind:** `FINDING`

| Field | Detail |
| --- | --- |
| **Symptom** | `verify` on `main` @ `7f5519c` failed `fetchPolygonTickerDetails: aborting the caller's signal terminates the real underlying connection` — connection proof timed out at 2000ms while full suite runs (~17k tests). |
| **Root cause** | Parallel tests can trip the Polygon breaker / sticky largo failover away from the local harness host, or defer admission long enough that no TCP socket appears within 2s. |
| **Fix** | `resetPolygonLargoRoutingForTest()` + reset breaker before each case; lengthen connection proof wait in CI (12s). |
| **Status** | FIXED on `fix/polygon-largo-cancellation-flake`. |

### Verify

Re-run `npm test` / `verify` on `main` after merge; same test should stop appearing in failed `not ok 10745` logs.
