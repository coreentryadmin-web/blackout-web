# Admin cron health age_min clock-skew guard

> **kind:** FINDING

## Symptom

`/admin` cron health board could report a **negative** `age_min` or falsely mark a job **healthy** when `cron_job_runs.started_at` was stamped slightly in the future (cross-replica clock skew).

## Root cause

`evaluateJob` in `admin-cron-health.ts` computed age as raw `(now - started_at) / 60_000` without the future-timestamp guard already used by `nighthawkJobAgeMin`, `isoAgeSec`, and `ageMinFromIso`.

## Fix

Route cron run age through `ageMinFromIso`; when age cannot be trusted (clock-skewed future), treat as `staleThreshold + 1` so the job surfaces as stale instead of infinitely fresh.

| **Status** | FIXED in fix/admin-cron-age-skew-guard |
