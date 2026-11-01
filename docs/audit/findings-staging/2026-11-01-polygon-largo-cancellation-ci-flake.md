> **kind:** `FINDING`

## 2026-11-01 — verify flake: polygon-largo cancellation harness under CI load — FIXED

| **Status** | FIXED on `fix/polygon-largo-cancellation-flake` |

| Field | Detail |
|---|---|
| **Symptom** | `verify` on `main` @ `7f5519c` failed `fetchPolygonTickerDetails: aborting the caller's signal terminates the real underlying connection` — proof timed out while the full suite ran (~17k tests). Log showed `fetch failed` when traffic never reached the local harness. |
| **Root cause** | (1) `POLYGON_API_BASE` was frozen at `polygon-largo` module load, so an earlier test import pinned the wrong origin for harness cases. (2) Keep-alive reused one TCP socket across sequential mock fetches, so waiting for a *new* connection made the ticker-details subtest time out. (3) Shared Polygon breaker / sticky largo failover could steer traffic off the harness host under parallel load. |
| **Fix** | Resolve primary/fallback inside `getPolygonBase()` on each call; `resetPolygonLargoRoutingForTest()` + breaker reset before each case; wait on inbound HTTP requests (not raw `connection` events); longer proof wait in CI (12s). |
| **Evidence** | CI run `41349118735` job `verify`; local `npx tsx --test src/lib/providers/polygon-largo-cancellation.test.ts` green post-fix. |
