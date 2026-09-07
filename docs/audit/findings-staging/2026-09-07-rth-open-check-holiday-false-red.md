> **kind:** `FINDING`

## RTH open-check false RED on NYSE holidays (Labor Day 2026-09-07) — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P1 (CI `open-check` failed on `main` @ 7246d9ad) |
| **Area** | `scripts/rth-open-check.mjs` |

### Symptom

`rth-open-check.yml` fired at 09:40 ET on Labor Day 2026-09-07 and failed `open-check` on `main` even though sibling holiday gates (#4519–#4522) correctly stopped warmers/crons. Writer checks were already skipped when `!isTradingDayEt`, but the harness still ran `data-correctness`, `provider-health-reconcile`, and the options-socket probe — which expects a live RTH session.

### Fix

After `validate:deploy` passes, exit GREEN when `!shouldRunRthSessionChecks(tradingDay)` (NYSE full-day closure). No socket/writer gates on a day with no equity open.

### Evidence

`node --test scripts/lib/rth-open-session.test.mjs` — Labor Day 2026-09-07 asserts `isTradingDayEt` false and session gates skipped.
