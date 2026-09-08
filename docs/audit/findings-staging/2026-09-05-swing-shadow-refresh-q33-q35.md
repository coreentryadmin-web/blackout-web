# 2026-09-05 — Swing shadow position refresh + gate evidence path (Q33–Q35)

## Problem

`swing_shadow_positions` rows were insert-only: no mark updates, no terminal close/grade, and no
consumption path. `commit.ts` claimed shadow evidence feeds the calibration ladder, but
`fetchGradedSwingFeatureRows` reads only `swing_positions`.

## Fix

### Q33–Q34 — refresh loop
- `src/lib/swing/shadow-refresh.ts` — mark latch + close on expiry / structural_stop / premium_stop
- `updateSwingShadowMarks`, `closeSwingShadowPosition`, `fetchGradedSwingShadowRows` in `db.ts`
- Wired into `swing-active-refresh` (bounded 25 shadows/pass, non-fatal)

### Q35 — consumption path
- `src/lib/swing/shadow-calibration.ts` — staged evidence tiers per blocked gate dimension:
  - n≥10 → PROVISIONAL (log only)
  - n≥30 → REVIEW_READY (recommend gate calibration review; does **not** auto-loosen budget/caps)

## Verification

```bash
npx tsx --test src/lib/swing/shadow-refresh.test.ts src/lib/swing/shadow-calibration.test.ts
npx tsc --noEmit
```

## RTH validation

- After discovery blocks a candidate into shadow, confirm `last_mark` advances on subsequent active-refresh ticks
- On expiry or stop hit, row should move to `CLOSED` with `graded_at` + `realized_pnl_pct`
