# 2026-09-04 — admin-fmtrel-future-guard

> **kind:** FINDING

## Admin API feed + SPX terminal relative times lacked future-timestamp guard

| Field | Detail |
|-------|--------|
| **Severity** | P3 |
| **Surface** | `/admin` API live feed + SPX terminal |
| **Status** | FIXED |

### Symptom

`AdminApiLiveFeed.tsx` and `AdminSpxTerminal.tsx` each had local `fmtRel()` helpers computing `Date.now() - new Date(iso)` without a future guard. Clock-skewed timestamps produced negative age → false **"just now"** / **"now"** labels — same failure class fixed in #3627 (`storeAge`) and #3641 (`timeAgoFromIso`).

### Fix

Extended `admin-time-ago.ts` with shared `isoAgeSec()` plus `timeAgoCompactFromIso()` / `openDurationLabelFromIso()`. Replaced duplicate local helpers in both admin surfaces.

### Evidence

- `npx tsx --test src/components/admin/admin-time-ago.test.ts` — 6 pass

### Market-open validation

- `/admin` → API live feed timestamps show plausible ages during RTH, not "just now" on skewed events
- SPX terminal feed + open-incident duration labels show "clock skew" when appropriate
