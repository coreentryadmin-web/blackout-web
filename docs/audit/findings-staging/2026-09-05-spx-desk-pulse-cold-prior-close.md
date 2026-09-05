## 2026-09-05 — [FINDING, P1 correctness] SPX desk pulse serves price:0 on cold replica off-hours when lastPulse is empty — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **What prompted this** | `validate:platform-integrity` FAIL `spx-desk-spot — SPX 0` on weekend while `thermal-spx-matrix` PASS spot≈7718, immediately after #4025/#4029 merges and ECS rollout (fresh tasks, empty in-process `lastPulseForSignals`). |
| **Root cause** | #3978 fixed off-hours pulse clobbering `lastPulseForSignals` with price:0, but the closed-market branch still returned `closedPulse` (price:0) when `lastPulseForSignals` was null — the normal state on a cold ECS replica that never served RTH that session. `buildSpxDesk` already had `priorFromBars.pdc` fallback; the fast pulse lane and minimal fallback did not. |
| **Fix** | Off-hours `buildSpxDeskPulse`: when `lastPulseForSignals` is absent, `await priorDayForPulseLane()` and serve `prior.pdc` with pdh/pdl. `buildSpxDeskPulseMinimal`: extend price chain with `prior.pdc`. |
| **Regression guard** | `src/features/spx/lib/spx-desk-offhours-spot.test.ts` — two new source-scan pins for prior-close cold path. |
| **RTH validation** | Weekend/off-hours after deploy: `/api/market/spx/desk` price must be >0 and within 1% of gex-heatmap SPX spot; `/terminal` header must not flash 0. |
