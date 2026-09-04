# uw-cache-refresh overlap guard — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **What prompted this** | 2026-09-04 performance sweep: `uw-cache-refresh` fires every 2 min with measured 20–66s background runtime but had no `sharedCacheSetNx` overlap guard. Live CloudWatch showed 939 member-facing `[uw] flow-alerts failed: rate-limiter queue budget exceeded` events in one 2.5h RTH window clustering at this cron's run windows (vs 27 off-hours). |
| **Root cause** | Multiple web-tier replicas dispatched overlapping 24-way UW REST fan-outs with no cross-replica lock — same failure mode already fixed on `desk-warm`, `vector-pick-sweep`, etc. |
| **Fix** | `sharedCacheSetNx` before background dispatch; `sharedCacheDel` in `finally` of `runUwCacheRefreshTasks`; idempotent skip JSON when lock held. TTL 600s matches `stale_after_min: 10`. |
| **Status** | FIXED |
