> **kind:** `FINDING`

## RTH open-check false RED on NYSE holidays — options-socket required after 09:30 on a closed tape — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P1 (CI `open-check` failed on main @ `7246d9ad` — Labor Day 2026-09-07) |
| **Area** | `scripts/rth-open-check.mjs`, `scripts/validate-deploy.mjs` |
| **PR** | (pending) |

### Symptom

`rth-open-check.yml` fires at 09:40 ET every weekday. On **2026-09-07 (Labor Day)** the job failed (`open-check` red on main) even though `#4522` already relaxed cron stale thresholds for holidays. Writer freshness checks were correctly skipped, but **options-socket still used `afterOpen930=true`** — requiring authenticated cluster marks on a closed tape. Local repro on the holiday: `validate:deploy` hard-failed with `options-socket (socket-health): probe HTTP 200`.

### Root cause

`socketProbeFinalFailure` only relaxes when `afterMarketOpen930` is false (pre-09:30). NYSE holidays are weekdays after 09:30, so the probe treated a closed market like a live RTH session.

### Fix

Pass `requireFreshMarks = afterOpen930 && isTradingDayEt(todayEtYmd())` into the shared socket probe from both `validate-deploy.mjs` and `rth-open-check.mjs` — same holiday awareness as writer checks and `#4520` cron health.

### Evidence

- `scripts/rth-open-check-require-fresh.test.mjs` — Labor Day not a trading day; requireFreshMarks false after 09:30
- `npm run validate:rth-open -- --force` GREEN on 2026-09-07 (holiday)
