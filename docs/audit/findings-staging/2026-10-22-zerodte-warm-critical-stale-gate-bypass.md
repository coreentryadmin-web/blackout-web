> **kind:** FINDING

## zerodte-warm — cooldown/overlap skips while scan heartbeat critical_stale — FIXED

| **Status** | FIXED (PR pending) |
| --- | --- |

**Symptom:** `Cron audit query` failed on `main` @ `0301d512` (2026-10-22 ~15:51 UTC, RTH) with `problems: zerodte-warm` despite #6546 heavy-slot escalation already on `main`.

**Root cause:** When `zerodte_scan_heartbeat` was already `critical_stale`, routine `zerodte-warm` fires could still idempotent-skip on the 60s rerun cooldown or the overlap lock (`previous zerodte warm still in flight`) before dispatching `warmZeroDteBoard()`. Wedged-lock steal cleared keys only on the atomic steal winner; subsequent fires hit cooldown/overlap gates without bypass.

**Fix:** During cash RTH, when heartbeat is `critical_stale`, bypass cooldown skip, retry overlap claim, and if still blocked force dispatch without deleting another replica's overlap lock (release only when this run acquired it).

**Verify after deploy:** During RTH with forced stale heartbeat in staging, confirm cron fires log `background done` and cron audit query returns GREEN.
