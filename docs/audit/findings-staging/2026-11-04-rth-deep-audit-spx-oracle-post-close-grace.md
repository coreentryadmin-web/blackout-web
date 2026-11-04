# RTH deep audit — SPX oracle prev-close false P0 at 16:02 ET

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## Symptom

RTH deep audit on `main` (`abc4f901`, 2026-11-04 21:02 UTC / **16:02 ET**) P0:

```
[oracle] SPX: desk 7683.82 vs Polygon prev-close 7568.92 (Δ 1.518% > 1.5% tol)
```

`gha-rth-audit` logged **RTH: open**; desk/snapshot spots were live (~7683–7686).

## Root cause

Oracle branch keyed RTH off Polygon `marketstatus/now` (`market === "open"`). That flips **closed at 16:00 ET** while
`inRthOpenWindow()` (and the scheduled audit) still runs through **16:15 ET**. The audit then compared a **live desk**
spot to **prior close** with the **1.5% off-hours tolerance** — normal +1.5% session gain reads as P0.

## Fix

Use `isTradingDayEt(todayEtYmd()) && inRthOpenWindow()` for oracle mode; live index snapshot + 0.3% tol in-window;
skip oracle off-hours (same as prior off-hours skip pattern).

## Verify

- `npx tsx --test scripts/full-site-deep-audit.test.mjs scripts/audit/lib/spx-oracle-eval.test.mjs`
- Next RTH deep audit pass during 16:00–16:15 ET grace
