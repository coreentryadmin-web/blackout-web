# Admin cron health clock-skew guard — FIXED

> **kind:** FINDING

## Summary

`evaluateJob` and the Night Hawk playbook branch in `admin-cron-health.ts` computed
`Date.now() - new Date(iso)` inline without the future-timestamp guard already shipped
for admin ops tiles (#3657). A clock-skewed `started_at`/`updated_at` read as negative
age → falsely **healthy** instead of stale/warning.

## Fix

- `adminAgeMinFromIso` helper in `admin-time-ago.ts`
- `evaluateJob` returns `warning` + "Last run timestamp clock skew" when age is untrusted
- Night Hawk stuck-job path uses the same helper + explicit clock-skew warning branch

## Evidence

`npx tsx --test src/components/admin/admin-time-ago.test.ts src/lib/admin-cron-health.test.ts` — 18/18 pass.

| **Status** | FIXED — PR pending |
