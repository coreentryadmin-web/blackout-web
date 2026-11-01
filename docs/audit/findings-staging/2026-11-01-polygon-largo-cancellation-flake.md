> **kind:** FINDING

## CI verify flake — polygon-largo-cancellation ticker-details subtest — FIXED

| **Status** | Fixed on branch `fix/polygon-largo-cancellation-flake` |

**Symptom:** `main` @ `7f5519c17` — `verify` red; `fetchPolygonTickerDetails: aborting the caller's signal…` failed
`assert.ok(socket)` after exactly ~2003ms; log showed `/v3/reference/tickers/AAPL failed: fetch failed`
(sibling `fetchPolygonNews` subtest passed).

**Root cause:** Full `npm test` runs all files in one process with default parallel subtests across files.
Shared `polygon-rate-limiter` admission can delay the real `fetch()` (and thus TCP to the local mock server)
longer than the test's fixed 2s `waitForNextConnection` window — not a product regression in #7277.

**Fix:** `beforeEach` reset of polygon circuit + queue-timeout alert latch; raise connection wait to 20s
with comment documenting suite contention.

**Verify:** `node --import tsx --test src/lib/providers/polygon-largo-cancellation.test.ts`; full `npm test` on PR CI.
