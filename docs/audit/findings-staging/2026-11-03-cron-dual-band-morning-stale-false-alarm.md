> **kind:** FINDING

## Cron watchdog false-stale on dual-band morning crons before in-window UTC tick — FIXED

| **Status** | FIXED |

**Symptom:** `Cron audit query` / RTH deep audit watchdog fallback failed with `problems: nighthawk-backfill-repair` at **2026-11-03 13:59 UTC** (~8:59 AM ET).

**Root cause:** `nighthawk-backfill-repair` (and siblings) use `0 13,14 * * 1-5` so one EventBridge tick lands in the 9:00 ET window in both DST regimes. The **13:00 UTC** band is expected to **skip** (before `inEtWindow`). `isInOffScheduleIdleGap` treats the 13:00→14:00 gap as **in-schedule** (≤2h), so a never-run or Friday-aged job read **stale** before the **14:00 UTC** in-window band fired.

**Fix:** `isAwaitingSecondaryUtcBandFire()` + wire into `evaluateJob` off-window / suppress-stale paths.

**Verify:** `npx tsx --test src/lib/cron-schedule-window.test.ts src/lib/admin-cron-health.test.ts`; next morning cron-audit before 14:00 UTC should not P0 on backfill-repair when awaiting the second band.
