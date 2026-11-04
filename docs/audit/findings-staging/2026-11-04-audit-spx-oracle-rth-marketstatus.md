> **kind:** FINDING

## RTH deep audit false P0: SPX oracle used prev-close during cash RTH — FIXED

**Status:** FIXED (`fix/audit-spx-oracle-intraday-rth`)

### Root cause

`scripts/full-site-deep-audit.mjs` chose live vs prior-close ground truth from Polygon
`marketstatus/now` only. When that probe failed or disagreed, `rth` stayed false during an
open ET session, so the audit compared live desk SPX to **prior close** with the **1.5%**
off-hours tolerance.

Run **41912133395** @ `abc4f901` (Wed 16:02 ET, gha-rth-audit logged `RTH: open`):
`desk 7683.82 vs Polygon prev-close 7568.92 (Δ 1.518% > 1.5% tol)` — a normal intraday move,
not a desk bug.

### Fix

Key oracle RTH on `inRthOpenWindow()` (same clock as `gha-rth-audit.mjs`), fetch live
`I:SPX` snapshot in-window and prev close off-hours.

### Evidence

- CI log run 41912133395 P0 line above.
- `scripts/audit/lib/spx-oracle-eval.test.mjs` — intraday desk vs prev-close case.
