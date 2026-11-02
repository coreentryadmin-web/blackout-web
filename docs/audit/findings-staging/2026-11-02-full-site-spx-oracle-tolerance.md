> **kind:** FINDING

## RTH deep audit false P0 — SPX oracle 5pt absolute gate — FIXED

| **Status** | Fixed on branch `fix/full-site-spx-oracle-tolerance` |

**Symptom:** Scheduled RTH deep audit run 41537722853 (off-hours) — P0 `[oracle] SPX: desk 7552.74 vs Polygon 7541.40 (Δ 11.34)`.

**Root cause:** `full-site-deep-audit.mjs` used a fixed **5 index-point** ceiling; off-hours desk spot vs Polygon `I:SPX` snapshot can diverge on field/staleness while staying sub-0.2% (data-validator already uses 1.5% off-hours).

**Fix:** Shared `evaluateSpxOracleAgreement` (0.3% RTH / 1.5% off-hours, same as data-validator) + unit tests.
