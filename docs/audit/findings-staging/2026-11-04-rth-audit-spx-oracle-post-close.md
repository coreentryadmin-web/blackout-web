> **kind:** FINDING

## RTH deep audit false P0: SPX oracle used prev-close after 16:00 ET — FIXED

| | |
|---|---|
| **Area** | `scripts/full-site-deep-audit.mjs` SPX Polygon oracle |
| **Status** | FIXED |
| **Severity** | P0 CI noise (not a member-facing spot defect) |

### Root cause

`RTH deep audit` run `41912133395` @ Wed 16:02 ET: Polygon `marketstatus` was already
`closed`, so the audit used `I:SPX/prev` (prior session close 7568.92) against live desk spot
7683.82. That is today's session level vs **yesterday's** close (Δ 1.518% > 1.5% off-hours tol) —
a normal post-close state, not a feed bug. GHA still treats 09:00–16:15 ET as an active audit
window (`inRthOpenWindow`).

### Fix

When `inRthOpenWindow()` OR Polygon market is open, use index **snapshot** ground truth and the
0.3% live tolerance. Reserve `I:SPX/prev` + 1.5% for overnight/weekend only.

### Evidence

CI log: `[oracle] SPX: desk 7683.82 vs Polygon prev-close 7568.92 (Δ 1.518% > 1.5% tol)`.
