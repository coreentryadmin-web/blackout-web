> **kind:** FINDING

## 2026-11-04 — RTH deep audit false P0: SPX oracle vs prior-day close off-hours — FIXED

| **Status** | FIXED on `fix/rth-audit-oracle-session-close-off-hours` |
| --- | --- |

**Symptom:** RTH deep audit @ `abc4f901` failed: P0 `[oracle] SPX: desk 7683.82 vs Polygon prev-close 7568.92 (Δ 1.518% > 1.5% tol)` at ~16:02 ET post-close.

**Root cause:** Off-hours oracle used Polygon `/prev` (prior session close) against desk last-session spot — after a ~+1.5% day that is expected divergence, not a desk bug.

**Fix:** Off-hours compare desk to Polygon index snapshot `session.close` (same session), keep live `value` during RTH.

**Verify:** Re-run full-site deep audit after a large move day off-hours — oracle should pass when desk aligns with session close.
