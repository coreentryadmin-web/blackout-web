## 2026-09-04 — [FINDING, P3 admin-display] `admin-cron-health` cron age could read negative on cross-replica clock skew — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P3 — admin dashboard display, no member-facing impact |
| **Surface** | `src/lib/admin-cron-health.ts` (`evaluateJob`, `nighthawk-playbook` override) |
| **Status** | FIXED |

### Root cause

`evaluateJob` computed `ageMin = (now - last.started_at) / 60_000` with no future guard. The Night Hawk playbook override used the same raw subtraction on `latestNhJob.updated_at`. A timestamp written by another ECS replica whose clock runs slightly ahead could yield a negative age, which never exceeds the stale threshold and could surface as `"-1m ago"` in status labels — the same defect class fixed earlier the same day in `play-engine-heartbeat.ts`.

### Fix

Reuse exported `clampedHeartbeatAgeMs()` from `play-engine-heartbeat.ts` for both age computations.

### Regression guard

`src/lib/admin-cron-health.test.ts` — future `started_at` yields `age_min: 0`, status stays `healthy`.

### Gates

`npx tsx --test src/lib/admin-cron-health.test.ts` — 8/8 pass · `npx tsc --noEmit` clean (Node 20.20.2).
