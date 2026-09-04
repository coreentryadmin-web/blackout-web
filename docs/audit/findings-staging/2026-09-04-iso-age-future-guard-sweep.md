# 2026-09-04 — iso-age-future-guard-sweep

> **kind:** FINDING

## Public GEX + Night Hawk mark age treated clock-skewed future timestamps as fresh

| Field | Detail |
|-------|--------|
| **Severity** | P3 |
| **Surface** | `/api/public/gex-snapshot`, Night Hawk Legacy rail mark age, admin Night Hawk playbook health |
| **Status** | FIXED |

### Symptom

Several ISO age helpers computed `Date.now() - new Date(iso)` without a future guard. A timestamp more than a few seconds ahead of wall clock produced a negative age; `public-gex-snapshot` coerced that to **0 seconds** (reads as "just refreshed"), and `legacyMarkAgeLabel` silently dropped only strictly-negative values while still mis-labeling small skew.

### Fix

Added shared `ageSecFromIso` / `ageMinFromIso` to `src/lib/ws/timestamp-freshness.ts` (reuses `WS_TIMESTAMP_FUTURE_TOLERANCE_MS`). Wired into `public-gex-snapshot.ts`, `legacy-board-detail-copy.ts`, and `admin-cron-health.ts` Night Hawk playbook age.

### Evidence

- `npx tsx --test src/lib/ws/timestamp-freshness.test.ts` — future +60s → null; +2s → 0s

### Market-open validation

- `/tools/gamma-snapshot` age field stays honest during RTH; Legacy Night Hawk row mark age does not show "0s ago" on skewed marks.
