# 2026-09-04 — [FINDING, P0 audit-harness] `full-site-deep-audit.mjs` used unconstrained wall derivation — FIXED

> **kind:** FINDING

| Field | Detail |
|---|---|
| **What broke** | Scheduled RTH deep audit failed 2026-09-04 14:02 ET with six P0 `[heatmap]` wall mismatches (e.g. `SPX.put_wall: reported 7700 != 8000`). |
| **Root cause** | `auditHeatmapMatrix()` derived expected walls via global argmax/argmin with **no spot side-constraint**. Production uses side-constrained `wallsFromStrikeTotals(totals, spot)` since #2417. |
| **Fix** | Import `wallsFromStrikeTotals` from `scripts/audit/lib/gex-wall-invariants.mjs` and pass `hm.spot`. Removed stale local `deriveWalls`. |
| **Evidence** | `scripts/full-site-deep-audit.test.mjs` — source guard. `gex-wall-invariants.test.mjs` covers the shared helper. |
| **Status** | FIXED |
