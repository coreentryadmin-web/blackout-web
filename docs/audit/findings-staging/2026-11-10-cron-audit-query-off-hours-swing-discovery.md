> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Title** | Cron audit query RED off-hours on swing-discovery (run 42735522106) |
| **Status** | FIXED |

## Root cause

Off-hours schedule (`5 */6 * * *`) at ~8:25 PM ET hit the HTTP watchdog fallback and exited 1 on `problem_keys: swing-discovery` while Postgres RTH checks are intentionally skipped off-window. Phase-anchored discovery staleness is validated during RTH-band runs (`5 11-21` UTC).

## Fix

`cron-audit-query.mjs`: outside `inRthOpenWindow()`, fail only on `error_spike === critical` or `rth_stale_keys` (market-hours crons stale during session), not generic `problem_keys`.
