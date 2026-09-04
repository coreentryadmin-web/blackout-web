# 2026-09-04 — admin-cron-health-future-age-guard

> **kind:** FINDING

## Admin cron health age_min lacked future-timestamp clamp

| Field | Detail |
|-------|--------|
| **Severity** | P3 |
| **Surface** | `/admin` → Operations → cron health matrix |
| **Status** | FIXED |

### Symptom

`evaluateJob()` computed `ageMin` from `now - started_at` without clamping negative values. A clock-skewed future `started_at` produced negative `age_min`, which never exceeded the stale threshold — the job falsely read as healthy instead of surfacing untrustworthy timing. The nighthawk-playbook stuck-job path had the same gap on `updated_at`.

### Fix

Clamp both paths with `Math.max(0, …)` — same failure class as #3627 (`storeAge`) and #3641 (`timeAgoFromIso`).

### Evidence

- `npx tsx --test src/lib/admin-cron-health.test.ts` — future `started_at` → `age_min: 0`

### Market-open validation

- `/admin` → Operations cron matrix: no cron row shows negative age during RTH
