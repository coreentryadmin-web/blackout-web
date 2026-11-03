> **kind:** FINDING

## Cron audit query red — nighthawk-backfill-repair pre-window false stale

| **Status** | FIXED (PR pending) |

**Symptom:** `Cron audit query` on `main` @ `6220d950` failed with `problems: nighthawk-backfill-repair` via HTTP watchdog fallback (~8:59 AM ET Tue 2026-11-03).

**Root cause:** Dual UTC band (`0 13,14 * * 1-5`) fires at 8:00 AM ET during EST before the route’s 9:00 AM repair window. Watchdog treated weekend-aged `cron_job_runs` as stale before the in-window 9:00 AM (14:00 UTC) tick was due.

**Fix:** `admin-cron-health.ts` suppresses stale/warning for `nighthawk-backfill-repair` on trading days before the same `inEtWindow` used by the route; early-band skip now logs `ok: true, skipped: true`.

**Verify:** After deploy, `npm run validate:cron` / watchdog should stay green between ~8:00–9:00 AM ET on weekdays; after ~10:30 AM ET without a successful in-window run, stale should still page.
