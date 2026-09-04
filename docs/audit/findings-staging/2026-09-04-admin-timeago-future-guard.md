# Admin timeAgoIso clock-skew guard — FIXED

> **kind:** FINDING

## Symptom

`timeAgo()` in `AdminOperationsDashboard.tsx` computed `Date.now() - new Date(iso).getTime()` with no future guard. Clock-skewed future ISO timestamps displayed "just now" because negative seconds still satisfy `s < 10`.

## Fix

Extracted `timeAgoIso()` into `admin-store-age.ts` alongside `storeAge()`, reusing `WS_TIMESTAMP_FUTURE_TOLERANCE_MS`. Beyond tolerance → `"clock skew"`.

## Evidence

`npx tsx --test src/components/admin/admin-store-age.test.ts` — 5 pass (3 storeAge + 2 timeAgoIso).

| **Status** | FIXED — pending merge |
