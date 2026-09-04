# Admin cron health — clock-skewed future `started_at` read as falsely fresh

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | admin / cron health |
| **PR** | (pending) |

## Symptom

`/admin` Operations cron health computed `ageMin` as raw `(now - started_at) / 60_000`. A clock-skewed **future** `started_at` produced a **negative** age, which never tripped the stale threshold — the job read as healthy when the timestamp was untrustworthy.

## Root cause

`evaluateJob()` in `src/lib/admin-cron-health.ts` did not use the shared `isoAgeSec` future guard already applied to Night Hawk job age (`nighthawkJobAgeMin`) and data-integrity freshness (`ageMinFromIso`).

## Fix

Added `cronRunAgeMin()` mirroring `nighthawkJobAgeMin`: future-skewed timestamps return `staleThreshold + 1` so the job surfaces as stale instead of falsely fresh.

## Evidence

- `src/lib/admin-cron-health.test.ts` — RED→GREEN: future `started_at` → `status: stale`, `age_min: 61`
- `npx tsx --test src/lib/admin-cron-health.test.ts`
