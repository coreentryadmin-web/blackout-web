> **kind:** FINDING

## 2026-11-03 — cron audit false P0 on nighthawk-backfill-repair before 9 AM ET — FIXED

| **Status** | FIXED (watchdog health) |
| **Severity** | P0 audit-harness |

**What broke:** `Cron audit query` on `main@6220d950` failed with `problems: nighthawk-backfill-repair` at Tue ~8:59 AM ET via HTTP watchdog fallback.

**Root cause:** Health board treated a last ok-run from the prior session as stale (>36h) while the repair route is intentionally not due until 9:00 AM ET. The earlier UTC dual-band tick (8:00 AM ET in EST) only logs a skip; the inter-band idle-gap logic does not cover “weekday morning before the ET window.”

**Fix:** `isBeforeNighthawkBackfillRepairWindow()` in `admin-cron-health.ts` suppresses stale/never-run noise before 9:00 AM ET on trading days.

**Verify:** `node --import tsx --test src/lib/admin-cron-health.test.ts`; next scheduled `cron-audit-query`.
