> **kind:** FINDING

## Full-site SPX oracle false P0 during RTH (prev-close path) — FIXED

| **Status** | Fixed in `fix/full-site-oracle-rth-fallback` |
| **CI** | RTH deep audit run `41912133395` on `abc4f901` (2026-11-04 16:02 ET) |

**What was broken:** `full-site-deep-audit.mjs` treated Polygon `marketstatus/now` as the sole RTH signal. When that call failed or disagreed, the audit compared live desk SPX to **prev-close** with the **1.5% off-hours** tolerance during an open ET session — failing at 1.518% on a normal up day (desk 7683 vs prev 7568).

**What changed:** `resolveOracleUsesLiveRth()` falls back to `inRthOpenWindow()` (same as `gha-rth-audit.mjs`); during live-RTH mode, prev-close is never used and a missing live snapshot skips instead of failing.

**Verify:** RTH deep audit oracle line should show `live` ground truth during weekday session hours, not `prev-close` with 1.5% tol.
