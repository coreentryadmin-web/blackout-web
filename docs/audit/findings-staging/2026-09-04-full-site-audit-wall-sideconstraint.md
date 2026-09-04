## 2026-09-04 — [FINDING, P0 audit-harness] RTH deep audit false P0 on heatmap walls — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Surface** | `scripts/full-site-deep-audit.mjs` |
| **Symptom** | Scheduled RTH audit P0 wall mismatches (e.g. `SPX.put_wall: reported 7700 != 8000`) while production data was correct |
| **Root cause** | Local `deriveWalls(strike_totals)` used unconstrained global argmax/argmin; production uses side-constrained `wallsFromStrikeTotals(totals, spot)` since #2417 |
| **Fix** | Import shared `wallsFromStrikeTotals` and pass `hm.spot` in the GEX wall check |
