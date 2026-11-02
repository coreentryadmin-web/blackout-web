> **kind:** FINDING

## GHA full-site deep audit P0'd SPX desk vs Polygon on a fixed $5 gap after RTH — FIXED

**Status:** FIXED (`fix/full-site-audit-spx-oracle-pct`)

### Root cause

`scripts/full-site-deep-audit.mjs` compared platform snapshot SPX to Polygon `I:SPX`
with `Math.abs(desk - oracle) > 5` dollars. After the close, Polygon index snapshot
`value` vs the desk's cached spot can differ by ~0.15% (~$11 on SPX) without a
product bug — the same pair passes `data-validator.mjs` (`priceTol` 0.3% RTH / 1.5%
off-hours) and `desk-verifier.ts` (`spotFractional: 0.005`).

Run **41537722853** on `main` @ `8f9e0d4db` failed `audit` with
`[oracle] SPX: desk 7552.74 vs Polygon 7541.40 (Δ 11.34)` at ~17:30 ET (post-RTH).

### Fix

Use percentage tolerance keyed off `inRthOpenWindow()` — 0.3% RTH, 1.5% off-hours —
matching `data-validator.mjs`. Regression test forbids reintroducing bare `d > 5`.

### Evidence

- CI `audit` job log on run 41537722853 (P0 oracle line above).
- `scripts/audit/data-validator.mjs` SPX / spx-desk oracle checks use `%` not `$5`.
