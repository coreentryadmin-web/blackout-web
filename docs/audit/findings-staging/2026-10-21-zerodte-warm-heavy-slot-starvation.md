> **kind:** FINDING

## zerodte-warm — heavy-cron pool starvation during critical scanner stall — FIXED

| **Status** | FIXED (PR pending) |
| --- | --- |

**Symptom:** `Cron audit query` failed on `main` three times in ~25 minutes (2026-10-21 ~15:55–16:19 UTC) with `problems: zerodte-warm` via the HTTP watchdog fallback.

**Root cause:** After wedged-lock steal (#5213) cleared cooldown/overlap, `acquireHeavyCronSlot` still returned `null` when both shared pool slots were held by long-running Vector crons. Each `zerodte-warm` fire logged `heavy-cron concurrency slot unavailable (idempotent skip)` while `zerodte_scan_heartbeat` stayed `critical_stale`.

**Fix:** When `scanHeartbeat.critical_stale` during cash RTH, escalate past the shared heavy-cron cap (noop slot handle) so the scanner tick can run; routine contention still idempotent-skips.

**Verify after deploy:** During RTH, confirm `zerodte-warm` completes `background done` and cron audit query GREEN after a period when Vector heavy crons are both in flight.
