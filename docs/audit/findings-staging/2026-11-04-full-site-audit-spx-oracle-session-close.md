> **kind:** FINDING

## Full-site SPX oracle false P0 after close (desk vs /prev) — FIXED

| **Status** | FIXED |

**Symptom:** RTH deep audit `41912133395` on `abc4f901`: P0 `[oracle] SPX: desk 7683.82 vs Polygon prev-close 7568.92 (Δ 1.518% > 1.5% tol)` at post-close.

**Root cause:** Off-hours oracle used only `/v2/aggs/ticker/I:SPX/prev` (prior session daily bar). Desk still serves **today's last print** after the bell — on a +1.5% session that reads as a P0 vs yesterday's close.

**Fix:** `pickOffHoursSpxOracleGroundTruth()` — prefer indices snapshot `session.close`, fall back to `/prev`.

**Verify:** `node --test scripts/audit/lib/spx-oracle-eval.test.mjs`
