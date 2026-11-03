> **kind:** FINDING

## RTH deep audit false P0: SPX oracle used live snapshot + 5pt cap off-hours

| **Status** | FIXED |

### What was broken

`scripts/full-site-deep-audit.mjs` compared platform snapshot SPX to Polygon index snapshot `value` with a fixed **5 point** threshold at all times. Off-hours (2026-11-02 17:30 ET run) desk **7552.74** vs Polygon **7541.40** (Δ 11.34) tripped P0 even though Δ ≈ **0.15%** — within `data-validator.mjs`'s off-hours **1.5%** tolerance when ground truth is **prior close**, not a mismatched live snapshot field.

### Fix

Extract `spxOracleVerdict` (`scripts/audit/lib/spx-oracle-eval.mjs`): RTH → live snapshot + 0.3% tol; off-hours → `I:SPX/prev` close + 1.5% tol. Wire into full-site deep audit.

### Market-open check

Next RTH deep audit / `node scripts/full-site-deep-audit.mjs` with cron auth — oracle line should PASS off-hours when desk tracks session close vs prev within 1.5%.
