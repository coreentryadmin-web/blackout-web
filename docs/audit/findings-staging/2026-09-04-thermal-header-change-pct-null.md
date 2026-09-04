# 2026-09-04 — Thermal header fabricated flat 0% change

> **kind:** FINDING

## Symptom

BlackOut Thermal (`/heatmap`) header showed **0.00%** day change when the matrix snapshot and live quote had **no** `change_pct` measurement. `GexHeatmap.tsx` coerced missing values with `?? 0`, and `TickerSwitcher` only hides the chip when `changePct == null` — so `0` rendered as a visible flat day.

## Root cause

```ts
const changePct = data?.change_pct ?? 0;
// ...
?? (quoteLive ? (quote!.change_pct ?? 0) : changePct)
```

SPX desk was fixed earlier (`spx-desk.ts` fail-closed to `null`); Thermal header path was not.

## Fix

- Extract `resolveHeaderChangePct()` — returns `null` when no lane has a real measurement; preserves legitimate `0%`.
- Wire `GexHeatmap` header through the helper.

## Evidence

- Unit: `src/features/thermal/lib/header-change-pct.test.ts` (null vs real 0% vs quote lane).
- RTH lifecycle GREEN after fix.

| **Status** | FIXED in PR |

## Market-open check

On `/heatmap` during RTH, pick a ticker whose matrix loads before quote — header should show spot **without** a 0.00% chip until change% resolves from quote/pulse.
