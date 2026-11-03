> **kind:** FINDING

## nighthawk-backfill-repair never logged a prod run — cron-audit query RED

| **Status** | FIXED (web belt + dispatch; infra EventBridge sync still recommended) |
| **Area** | `nighthawk-backfill-repair`, `cron-staleness-watchdog`, `nighthawk-morning-confirm` |
| **CI** | Cron audit query run 41649123458 on `6220d950` — `problem_keys: nighthawk-backfill-repair` |

**Root cause:** Route + `railway.nighthawk-backfill-repair.toml` + registry entry shipped, but production
`cron_job_runs` had `last_run_at=null` (EventBridge rule likely never synced from blackout-infra).
Morning-confirm fired daily; dedicated 9:00 AM repair cron did not.

**Fix:** Wire `nighthawk-backfill-repair` into `CRON_DISPATCH` (force idempotent repair). Belt from
`nighthawk-morning-confirm` before edition read. Synchronous watchdog belt when stale so
`validate:cron` clears on the same watchdog pass. Optional self-heal target when
`CRON_WATCHDOG_SELF_HEAL=1`.

**Verify:** After deploy, `npm run validate:cron` GREEN; admin cron-health shows recent
`nighthawk-backfill-repair` row; sync `nighthawk-backfill-repair` in blackout-infra `cron-jobs.json`.
