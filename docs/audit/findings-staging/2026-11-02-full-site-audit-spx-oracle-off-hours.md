> **kind:** FINDING

## Full-site deep audit false P0 SPX oracle off-hours — FIXED

| **Status** | FIXED (PR pending) |

**Symptom:** RTH deep audit failed on `main` (`8f9e0d4`): P0 `[oracle] SPX: desk 7552.74 vs Polygon 7541.40 (Δ 11.34)` at Mon 17:30 ET (market closed).

**Root cause:** `scripts/full-site-deep-audit.mjs` always compared platform snapshot SPX to Polygon `/v3/snapshot/indices` `value` with a fixed $5 absolute band. After the close, indices snapshot can lag or diverge from the desk’s last session print; `scripts/audit/data-validator.mjs` already uses live indices during RTH and `I:SPX/prev` off-hours with percent tolerance.

**Fix:** `polygonSpxOracleGroundTruth()` — marketstatus gate, RTH 0.3% / off-hours 1.5% tolerance parity with data-validator.

**Verify:** `node --test scripts/full-site-deep-audit.test.mjs`; next RTH deep audit run off-hours should not P0 on ~0.15% desk vs prev-close drift.
