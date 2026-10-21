# zerodte-warm starved by heavy-cron slots while scan heartbeat critical_stale

> **kind:** FINDING

## What broke

Scheduled **Cron audit query** failed at 15:55 UTC: watchdog reported `zerodte-warm` stale during RTH (scan heartbeat `critical_stale` — discovery path >10m without a tick).

With `MAX_CONCURRENT_HEAVY_CRONS=2`, long-running siblings can occupy both slots; `zerodte-warm` then logs `heavy-cron concurrency slot unavailable` every fire while the heartbeat stays critical — self-heal and wedge-breaker never run the scanner.

## Fix

When `scanHeartbeatCritical` during cash RTH, proceed without a heavy-cron slot (overlap lock + UW sweep tag still apply). Dedupe watchdog keys in `cron-audit-query.mjs` output.

| **Status** | FIXED (PR pending) |
