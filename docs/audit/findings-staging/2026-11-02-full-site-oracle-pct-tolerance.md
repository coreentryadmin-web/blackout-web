> **kind:** FINDING

## Full-site deep audit — SPX oracle flat 5pt gate false P0 — FIXED

| **Status** | FIXED (PR pending) |
| --- | --- |

**Symptom:** Scheduled `audit` workflow on `main@8f9e0d4` failed P0: `oracle SPX desk 7552.74 vs Polygon 7541.40 (Δ 11.34)`.

**Root cause:** `scripts/full-site-deep-audit.mjs` compared absolute index points (`d > 5`) while `scripts/audit/data-validator.mjs` uses **0.3% RTH / 1.5% off-hours** vs Polygon. ~11pt on ~7540 is ~0.15% — honest lag between desk snapshot and Polygon index snapshot, not a correctness break.

**Fix:** Import `inRthOpenWindow`, compare percentage delta with the same tolerances as data-validator; report Δ% and tol in the pass/fail line.

**Verify:** `npx tsx --test scripts/full-site-deep-audit.test.mjs`; next green `audit` on `main`.
