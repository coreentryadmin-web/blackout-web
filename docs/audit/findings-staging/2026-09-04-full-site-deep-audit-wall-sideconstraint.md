## 2026-09-04 — [FINDING, P0] RTH deep audit heatmap wall oracle ignored spot side constraint

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Surface** | `scripts/full-site-deep-audit.mjs` (RTH deep audit / `gha-rth-audit.mjs`) |
| **Symptom** | Scheduled RTH audit flagged P0 heatmap mismatches (`SPX.put_wall`, `SPY.put_wall`, `NVDA.call_wall`, `AAPL` walls, `META.call_wall`) — reported walls matched unconstrained max ±gamma strikes, not production side-constrained walls |
| **Root cause** | `deriveWalls(strike_totals)` picked global max positive/negative gamma without requiring call wall above spot and put wall below spot. Production and `heatmap-verifier.ts` have used side-constrained walls since #2417 / ops fix #2503 |
| **Fix** | Pass `hm.spot` into `deriveWalls` and side-constrain like `heatmap-verifier.ts` |
| **Evidence** | GHA run ~33903727473 on `main@a52e140b`; ratchet in `heatmap-verifier.test.ts` |
