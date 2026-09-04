# Night Hawk cron health: future `updated_at` bypassed stuck detection

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | admin / cron-health |

## Symptom

`buildCronHealthSnapshot()` computed `nighthawk-playbook` job age as raw `Date.now() - updated_at` without a future-timestamp guard. A clock-skewed `updated_at` in the future produced a **negative** `ageMin`, so `ageMin > STUCK_JOB_MIN` never tripped and a non-terminal Night Hawk build could read as healthy while its timestamp was untrustworthy.

## Root cause

`src/lib/admin-cron-health.ts` lines 365–368 used unguarded `Math.round((Date.now() - new Date(updatedAt).getTime()) / 60_000)` while sibling admin paths already use `isoAgeSec` / `adminAgeMsFromIso` (PRs #3652, #3657).

## Fix

Reuse `isoAgeSec` via exported `nighthawkJobAgeMin()` — clock-skewed timestamps return `stuckThresholdMin + 1` so non-terminal jobs escalate to `stale` like other untrustworthy ages.

## Evidence

`npx tsx --test src/lib/admin-cron-health.test.ts` — new tests for future/past `updated_at`.
