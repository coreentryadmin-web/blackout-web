## 2026-09-04 — [P3, ops telemetry] Admin cron health treated clock-skewed future timestamps as fresh — FIXED

> **kind:** `FINDING`

| Field | Detail |
|-------|--------|
| **Severity** | P3 — false-green cron/Night Hawk job health on cross-process clock skew |
| **Surface** | `/admin` Operations cron board — `evaluateJob()` + Night Hawk playbook stuck detection |
| **Status** | FIXED |

### Root cause

`admin-cron-health.ts` computed job age as raw `Date.now() - new Date(iso)` without the future-timestamp guard already shipped for admin feed labels (`admin-time-ago.ts`, #3627/#3641). A `started_at` or Night Hawk `updated_at` stamped slightly in the future produced a **negative** age that never crossed the stale/stuck thresholds — the board read healthy while progress timestamps were untrustworthy.

### Fix

- Added `adminAgeMinFromIso()` — shared fail-closed minute age (clock-skew → `failClosedMin + 1`).
- Wired into `evaluateJob()` staleness and Night Hawk playbook stuck-job detection.

### Evidence

- `npx tsx --test src/components/admin/admin-time-ago.test.ts src/lib/admin-cron-health.test.ts` — 18/18 pass
- `npx tsc --noEmit` — clean

### Market-open validation

- `/admin` → Operations → cron health: no cron with a skewed `started_at` should show OK during RTH when age cannot be verified
