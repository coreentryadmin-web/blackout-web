# 2026-09-04 — admin-spx-dashboard-stale-future-guard

> **kind:** FINDING

## Admin SPX dashboard staleness check lacked future-timestamp guard

| Field | Detail |
|-------|--------|
| **Severity** | P3 |
| **Surface** | `/admin` SPX dashboard stale banner |
| **Status** | FIXED |

### Symptom

`AdminSpxDashboard.tsx` computed `staleMs = Date.now() - new Date(data.generated_at)` without a future guard. A clock-skewed future `generated_at` produced negative age → falsely **fresh** desk data (no stale banner) — same failure class fixed in #3627/#3652 for sibling admin surfaces.

### Fix

Added `adminAgeMsFromIso()` to `admin-time-ago.ts` (reuses `isoAgeSec`); wired SPX dashboard staleness to treat clock-skew/null as stale.

### Evidence

- `npx tsx --test src/components/admin/admin-time-ago.test.ts` — 8 pass

### Market-open validation

- `/admin` SPX dashboard: confirm stale banner appears (or shows `?` age) when `generated_at` is future-skewed during RTH, not silently fresh.
