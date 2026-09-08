# 2026-09-05 — Swing ex-dividend structural stop adjustment (Q39)

## Problem

`structuralStopBroken` compared raw underlying spot to `thesis_invalidation_px` with no
ex-dividend adjustment. On ex-div day a LONG position can see a mechanical open gap (~cash dividend)
that breaches the stop even when the thesis did not break.

## Fix

- `ex-dividend-adjustment.ts` — on ex-div session, add cash dividend to LONG spot before compare
- `ex-dividend-reads.ts` — resolve ex-div context via Polygon dividends (6h in-memory cache)
- `manage.ts` / `manage-sync.ts` — wire `exDividendSession` + `exDividendCash` through reads
- `swing-active-refresh` — fetch per-ticker ex-div context each tick (fail-soft)

## Verification

```bash
npx tsx --test src/lib/swing/ex-dividend-adjustment.test.ts src/lib/swing/manage.test.ts
npx tsc --noEmit
```

## RTH validation

- On ex-div day for a held dividend payer, confirm structural_stop does NOT fire when raw spot
  is below stop only by ≤ declared cash dividend amount
- Non-ex-div days unchanged
