> **kind:** FINDING

## RTH deep audit false P0: SPX oracle used prev-close during 16:00–16:15 ET grace

| **Status** | FIXED |

### What was broken

`scripts/gha-rth-audit.mjs` treats **09:00–16:15 ET** as RTH (`inRthOpenWindow`). At **16:02 ET** (2026-11-04, `main` @ `abc4f901`) Polygon `marketstatus` is already **closed**, so `full-site-deep-audit.mjs` compared live desk **7683.82** to **prev-close 7568.92** (Δ **1.518%** > 1.5% off-hours tol) → P0 while the rest of the audit correctly showed live SPX ~7686.

### Fix

`fetchSpxPolygonOracle` (`scripts/audit/lib/spx-oracle-ground.mjs`): RTH mode keyed off **`inRthOpenWindow()`** (live index snapshot + 0.3% tol); true off-hours use today's daily close when available, else prev-close + 1.5% tol.

### Market-open check

Next weekday run after **16:00 ET** while still inside the 15m grace — oracle line should PASS with `Polygon live` label, not `prev-close`.
