## 2026-09-04 — [FINDING, P2 data-correctness/UI] SPX spot headers painted bullish when `spx_change_pct` was unknown — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | `SpxLiveSpotPrice`, `SpxSniperHeader` strip spot, and `SpxIosMarketStrip` used `(desk?.spx_change_pct ?? 0) >= 0` for bull/bear text and border classes. When day change was genuinely unknown (`null`), the UI showed green bull styling while `fmtPct` correctly rendered `—`. |
| **Root cause** | Tone logic coerced missing change to `0`, which is a valid bullish value, instead of treating absence as neutral — same failure class as Thermal's `change_pct ?? 0` fabrication fixed earlier today. |
| **Fix** | Added `dayChangeTextClass()` / `dayChangeBorderClass()` beside `pctClass()` in `src/lib/api.ts`; all three SPX spot surfaces now use them. |
| **Regression guard** | `src/lib/api-day-change-tone.test.ts` — unit tests for neutral/signed paths + source scan banning `spx_change_pct ?? 0` in the three components. |
| **Status** | FIXED |
