# 2026-09-04 — playbook-data-quality future timestamp false-fresh

> **kind:** FINDING

| Field | Detail |
|---|---|
| **Symptom** | Future `polled_at`/`as_of` on SPX desk produced `ageSec = 0` via `Math.max(0, negative)`, so `desk_stale` stayed false and live playbook BUY gating treated a clock-skewed snapshot as fresh. |
| **Root cause** | `playbookDataQualityFlags` lacked the future-timestamp guard already applied in `spx-play-gates.ts` via `ZERODTE_MARK_FUTURE_TOLERANCE_MS`. |
| **Fix** | Reject future stamps as stale (`playGexStaleMaxSec() + 1`); unit test added. |
| **Status** | FIXED |
