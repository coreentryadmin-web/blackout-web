# SPX deep-audit oracle false P0 off-hours (price vs prev close)

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## Symptom

RTH deep audit on `main` @ `abc4f901` (2026-11-04 ~21:03 UTC, market closed):

```text
P0: [oracle] SPX: desk 7683.82 vs Polygon prev-close 7568.92 (Δ 1.518% > 1.5% tol)
```

## Root cause

Off-hours branch compared **platform snapshot session price** (~today's close) to **Polygon previous daily close**. On any session with |day change| > 1.5%, the check false-fails even when desk data is correct.

## Fix

Off-hours: fetch `/api/market/spx/desk`, compare `prior_close` to Polygon `I:SPX/prev` with **0.05%** tolerance (same as `data-validator.mjs` `spx-desk: prior_close vs Polygon prev close`). RTH unchanged (live vs live, 0.3%).

## Verify

- `npx tsx --test scripts/audit/lib/spx-oracle-eval.test.mjs`
- `npx tsx --test scripts/full-site-deep-audit.test.mjs`
