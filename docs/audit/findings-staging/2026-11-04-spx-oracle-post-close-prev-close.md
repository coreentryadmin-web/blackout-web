> **kind:** FINDING

## RTH deep audit false P0: SPX oracle used /prev after same-day close — FIXED

| **Status** | FIXED |

**Symptom:** RTH deep audit RED **2026-11-04 16:02 ET** — `[oracle] SPX: desk 7683.82 vs Polygon prev-close 7568.92 (Δ 1.518% > 1.5% tol)`.

**Root cause:** Polygon `marketstatus` was already **closed** after the 4:00 PM bell, but platform snapshot still serves **today's session** price. `/prev` is **yesterday's** close — delta equals the legitimate daily move, not a desk bug.

**Fix:** `spxPolygonGroundTruth` — when not RTH, prefer index snapshot **session close** before falling back to `/prev`. Wired in `full-site-deep-audit.mjs`.

**Verify:** Next post-close RTH deep audit pass; regression in `spx-oracle-eval.test.mjs`.
