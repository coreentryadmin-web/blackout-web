> **kind:** FINDING

## zerodte-warm chronically RTH-stale under shared heavy-cron pool — FIXED

| **Status** | FIXED (reserved dedicated heavy-cron slot) |

**Symptom:** Scheduled `Cron audit query` and `ops:collect` repeatedly reported P0 `RTH stale cron: zerodte-warm` during RTH (GitHub issue #5919, fingerprint `7ad697141b6b`). Watchdog HTTP fallback showed `problems: zerodte-warm` while origin `/api/health` stayed 200.

**Root cause:** `zerodte-warm` competed for the two shared `acquireHeavyCronSlot` keys with multi-minute vector crons. The route's fast handshake still logged `cron_job_runs`, but the background `warmZeroDteBoard()` scan often never started (`heavy-cron concurrency slot unavailable`), so `zerodte_scan_heartbeat` went `critical_stale` and `admin-cron-health` correctly overrode status to stale in-window.

**Fix:** Add `zerodte-warm` to `RESERVED_SLOT_CRONS` (same pattern as `swing-active-refresh` #5975-era starvation fix) so it always has its own slot and cannot be starved by vector-pick-sweep / vector-full-state-snapshot occupancy.

**Verify after deploy:** `npm run validate:cron` green; ops issue #5919 fingerprint clears; `/api/admin/cron-health` shows `zerodte-warm` healthy during RTH with recent scan heartbeat.
