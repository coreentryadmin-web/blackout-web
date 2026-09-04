## 2026-09-04 — [FINDING, P2 data-correctness] Thermal GexHeatmap fabricated flat +0.00% day change — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | When the matrix payload omitted `change_pct` and the live quote had not yet arrived, the Thermal header beside the ticker selector rendered `+0.00%` — a fabricated flat day, violating the "every number is real or omitted" rule. |
| **Root cause** | `GexHeatmap.tsx` used `data?.change_pct ?? 0` and multiple `quote!.change_pct ?? 0` fallbacks in the `headerChangePct` chain. `TickerSwitcher` treated `0 != null` as truthy and painted the chip. Sibling `ThermalCompareStrip.tsx` already used `?? null` and hid the chip when absent. |
| **Fix** | Thread `matrixChangePct` as `number \| null` with `Number.isFinite` guards; propagate `null` through the pulse/quote/stock-push overlay chain; only render the % chip (and sr-only change wording) when `changePct != null`. |
| **Regression guard** | `src/features/thermal/components/GexHeatmap-header-change-pct.test.ts` — source-scan asserts no `?? 0` coercion in the header tape block. |
| **Status** | FIXED |
