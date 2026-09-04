# 2026-09-04 — iso-age-future-guard-combined

> **kind:** FINDING

## Public GEX + Night Hawk mark age treated clock-skewed future timestamps as fresh

| Field | Detail |
|-------|--------|
| **Severity** | P3 |
| **Surface** | `/api/public/gex-snapshot`, Night Hawk Legacy rail mark age, admin Night Hawk playbook health |
| **Status** | FIXED |

### Symptom

Several ISO age helpers computed `Date.now() - new Date(iso)` without a future guard. `public-gex-snapshot` coerced negative age to **0 seconds** (reads as "just refreshed"). Night Hawk Legacy `legacyMarkAgeLabel` dropped only strictly-negative values. Admin Night Hawk playbook health used raw age math so future-skewed `updated_at` produced negative `ageMin`, bypassing stuck detection.

### Fix

- Shared `ageSecFromIso` / `ageMinFromIso` in `timestamp-freshness.ts` (reuses `WS_TIMESTAMP_FUTURE_TOLERANCE_MS`)
- `public-gex-snapshot.ts` + `legacy-board-detail-copy.ts` wired to `ageSecFromIso`
- `nighthawkJobAgeMin()` in `admin-cron-health.ts` reuses `isoAgeSec` — clock-skewed timestamps return `stuckThresholdMin + 1` so stuck escalation fires

### Evidence

- `npx tsx --test src/lib/ws/timestamp-freshness.test.ts`
- `npx tsx --test src/lib/admin-cron-health.test.ts`

### Market-open validation

- `/tools/gamma-snapshot` age field stays honest during RTH
- Legacy Night Hawk row mark age does not show "0s ago" on skewed marks
- `/admin` → Operations → Cron health: skewed Night Hawk `updated_at` shows stale/stuck, not healthy
