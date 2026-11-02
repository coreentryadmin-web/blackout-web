> **kind:** FINDING

## RTH deep audit — SPX oracle flat 5pt false P0 (2026-11-02)

| **Status** | FIXED |
| --- | --- |
| **Symptom** | `audit` job on `main` @8f9e0d4 — P0 `[oracle] SPX: desk 7552.74 vs Polygon 7541.40 (Δ 11.34)`; desk aligned snapshot; not a Dependabot regression. |
| **Root cause** | `full-site-deep-audit.mjs` used hard `Δ > 5` points; ~0.15% cross-source lag at ~7550 SPX exceeds 5pt but is within `data-validator.mjs` `priceTol` (0.3% RTH / 1.5% off-hours). |
| **Fix** | Oracle check uses same percent bands via `inRthOpenWindow()`. |
| **Verify** | `node --test scripts/full-site-deep-audit.test.mjs`; next RTH deep audit run. |
