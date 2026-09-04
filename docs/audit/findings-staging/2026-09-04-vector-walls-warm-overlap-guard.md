## 2026-09-04 — [PERF, P2 cron] vector-walls-warm cross-replica overlap guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (PR pending) |
| **Root cause** | `vector-walls-warm` lacked the `sharedCacheSetNx` overlap guard already on `desk-warm`, `heatmap-warm`, and `meridian-warm`. It has dual triggers — EventBridge ~5min schedule plus `rth-warm-leader` with a 20s heal threshold — so concurrent invocations could fan out universe Polygon chain fetches across web-tier replicas. |
| **Fix** | `OVERLAP_LOCK_KEY = "vector-walls-warm:running"` with 240s TTL (2× `maxDuration`), acquire before `after(dispatchWarming)`, idempotent skip on lost race, `finally` release, fail-open on Redis error. |
| **Tests** | `src/app/api/cron/vector-walls-warm/route.test.ts` — overlap guard regression tests mirror `desk-warm` pattern. |
