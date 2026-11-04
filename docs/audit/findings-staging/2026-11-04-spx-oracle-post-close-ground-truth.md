> **kind:** FINDING

## RTH deep audit false P0: SPX oracle compared desk to `/prev` after cash close

| **Status** | FIXED |

### What was broken

**RTH deep audit** failed on `main@abc4f901` (2026-11-04 ~16:02 ET) with P0 `[oracle] SPX: desk 7683.82 vs Polygon prev-close 7568.92 (Δ 1.518% > 1.5% tol)`. After the cash session, the platform snapshot correctly showed **today's** settle; Polygon `/prev` is still **yesterday's** bar — a valid ~1.5% session move read as a desk bug.

### Fix

`spxOracleGroundTruthPlan` / `resolvePolygonSpxOracleGroundTruth`: live snapshot when `marketstatus` open; on trading days **after 16:00 ET** use today's daily aggregate (with snapshot session.close fallback); otherwise `/prev`.

### Verify

Next weekday RTH deep audit run after 16:00 ET should pass oracle when desk matches today's Polygon daily close.
