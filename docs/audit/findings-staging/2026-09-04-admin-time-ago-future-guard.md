# 2026-09-04 — admin-time-ago-future-guard

> **kind:** FINDING

## Admin panel `timeAgo()` showed "just now" for clock-skewed future ISO timestamps

| Field | Detail |
|-------|--------|
| **Severity** | P3 |
| **Surface** | `/admin` Operations + X Marketing panels |
| **Status** | FIXED |

### Symptom

`timeAgo(iso)` in `AdminOperationsDashboard.tsx` and `AdminXMarketingPanel.tsx` computed `Date.now() - new Date(iso).getTime()` without a future guard. Future timestamps beyond tolerance produced negative age and displayed **"just now"** — same failure class as #3627's `storeAge()`.

### Fix

Extracted shared `timeAgoFromIso()` in `admin-time-ago.ts`, reusing `WS_TIMESTAMP_FUTURE_TOLERANCE_MS`. Beyond tolerance returns `"clock skew"`; otherwise clamps with `Math.max(0, ...)`.

### Evidence

- `npx tsx --test src/components/admin/admin-time-ago.test.ts` — 3 pass

### Market-open validation

- `/admin` → Operations incidents/audit timestamps show sensible ages during RTH, not "just now" on skewed rows.
