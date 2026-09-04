# 2026-09-04 — [FINDING, P0 audit-harness] `full-site-deep-audit.mjs` used unconstrained wall derivation — FIXED

> **kind:** FINDING

| Field | Detail |
|---|---|
| **What broke** | Scheduled RTH deep audit (`gha-rth-audit.mjs` → `full-site-deep-audit.mjs`) failed 2026-09-04 14:02 ET with six P0 `[heatmap]` wall mismatches (e.g. `SPX.put_wall: reported 7700 != 8000`). |
| **Root cause** | `auditHeatmapMatrix()` derived expected walls via a local `deriveWalls(strike_totals)` that picked global argmax/argmin with **no spot side-constraint**. Production uses side-constrained `wallsFromStrikeTotals(totals, spot)` since #2417/#2521. |
| **Why it false-failed** | SPX at ~7708: unconstrained max-negative strike is 8000 (below spot), but the served put wall is 7700 (largest negative **below** spot). Data was correct; the audit compared against the wrong definition. |
| **Fix** | Import `wallsFromStrikeTotals` from `scripts/audit/lib/gex-wall-invariants.mjs` and pass `hm.spot` in the heatmap matrix check. Removed the stale local `deriveWalls`. |
| **Evidence** | `scripts/full-site-deep-audit.test.mjs` — source guard. `gex-wall-invariants.test.mjs` already covers the shared helper. |
| **Status** | FIXED |
