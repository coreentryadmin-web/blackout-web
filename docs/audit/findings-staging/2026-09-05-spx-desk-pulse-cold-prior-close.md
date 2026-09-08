## 2026-09-05 — [FINDING, P1 correctness] SPX desk pulse serves price:0 on cold replica off-hours when lastPulse is empty — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **What prompted this** | `validate:platform-integrity` FAIL `spx-desk-spot — SPX 0` on weekend while `thermal-spx-matrix` PASS spot≈7718, immediately after #4025/#4029 merges and ECS rollout (fresh tasks, empty in-process `lastPulseForSignals`). |
| **Root cause** | #3978 fixed off-hours pulse clobbering `lastPulseForSignals` with price:0, but the closed-market branch still returned `closedPulse` (price:0) when `lastPulseForSignals` was null — the normal state on a cold ECS replica that never served RTH that session. `buildSpxDesk` already had `priorFromBars.pdc` fallback; the fast pulse lane and minimal fallback did not. |
| **Fix** | Off-hours `buildSpxDeskPulse`: when `lastPulseForSignals` is absent, `await priorDayForPulseLane()` and serve `prior.pdc` with pdh/pdl. `buildSpxDeskPulseMinimal`: extend price chain with `prior.pdc`. **Follow-up (same PR, per Cursor review):** `priorDayForPulseLane()` is itself "never block cold" — on a TRUE cold cache it fires the real fetch in the background and returns `pdc:null` immediately, so the very first off-hours request after a rollout still fell through to `price:0`. Fixed by awaiting `fetchPriorDayCached()` as a fallback when `priorDayForPulseLane()` comes back empty — off-hours has no fast-lane latency budget to protect, so the extra blocking fetch is safe. `buildSpxDeskPulseMinimal` deliberately left unchanged (it protects a real RTH latency budget via `Promise.race(...400ms)`). |
| **Regression guard** | `src/features/spx/lib/spx-desk-offhours-spot.test.ts` — three source-scan pins for the prior-close cold path (two from the original fix, a third for the `fetchPriorDayCached()` fallback). |
| **RTH validation** | Weekend/off-hours after deploy: `/api/market/spx/desk` price must be >0 and within 1% of gex-heatmap SPX spot; `/terminal` header must not flash 0. |
