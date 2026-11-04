> **kind:** FINDING

## RTH deep audit false P0: SPX oracle used /prev after same-day close

| **Status** | FIXED |

### What was broken

2026-11-04 16:02 ET run: desk **7683.82** vs Polygon **prev-close 7568.92** (Δ **1.518%** > 1.5% tol). Market was closed but the platform snapshot still carried **today’s** index; `/v2/aggs/ticker/I:SPX/prev` was still **yesterday’s** session close on a +1.5% day — not a desk bug.

### Fix

`offHoursUsesSessionClose()` + today’s `I:SPX/range/{ymd}/{ymd}` close after 4 PM ET on trading days; fall back to `/prev` overnight/pre-open.

### Market-open check

Post-close RTH deep audit oracle line should PASS when desk tracks today’s official close within 1.5%.
