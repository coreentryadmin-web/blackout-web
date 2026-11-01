> **kind:** FINDING

## polygon-largo-cancellation.test.ts flaky on full verify (2026-11-01)

| **Status** | FIXED |

**Symptom:** `verify` on `main` @ `7f5519c` failed with `fetchPolygonTickerDetails: aborting the caller's signal…` — assertion "the request must actually reach the server" after exactly ~2003ms (connection wait timeout).

**Cause:** Test runs late in the full suite (~test 10745). `polygonTrackedFetch` → `acquirePolygonSlot` can queue before the localhost TCP connect; the fixed 2s `waitForNextConnection` bound matched CI tail latency, not a regression in abort wiring.

**Fix:** `resetPolygonCircuitForTest()` before each case; raise connection wait to 10s so admission queue + connect still proves real socket abort.

**Check:** `npx tsx --test src/lib/providers/polygon-largo-cancellation.test.ts`; next full `verify` on `main`.
