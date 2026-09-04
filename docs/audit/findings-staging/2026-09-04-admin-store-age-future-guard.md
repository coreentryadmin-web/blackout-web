# 2026-09-04 — admin-store-age-future-guard

> **kind:** FINDING

## Admin ops tile age showed "just now" for clock-skewed future timestamps

| Field | Detail |
|-------|--------|
| **Severity** | P3 |
| **Surface** | `/admin` Operations dashboard store freshness tiles |
| **Status** | FIXED |

### Symptom

`storeAge()` in `AdminOperationsDashboard.tsx` computed `Date.now() - updatedAt` without a future guard. A timestamp more than a few seconds ahead of wall clock produced a negative age; `Math.floor(negative / 1000) < 10` evaluated true, so the tile read **"just now"** with a green ok state — the same failure class called out in the hourly autonomous wake checklist (`Date.now() - timestamp without future guard`).

### Fix

Extracted `storeAge()` to `src/components/admin/admin-store-age.ts`, reusing `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` from the shared WS freshness helper. Timestamps beyond tolerance return `{ label: "clock skew", ok: false }`; otherwise age is clamped with `Math.max(0, ...)`.

### Evidence

- `npx tsx --test src/components/admin/admin-store-age.test.ts` — 3 pass (future +60s → clock skew; +2s → just now; null → No data)

### Market-open validation

- Sign in to `/admin` → Operations → confirm UW/Polygon store tiles show sensible age labels during RTH (not "just now" on a stale/skewed store).
