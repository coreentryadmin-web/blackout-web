## 2026-09-04 — [FINDING, P3 Performance] zerodte-warm missing force=1 cooldown — FIXED

> **kind:** FINDING

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Root cause** | Same structural gap as desk-warm (#3540) and heatmap-warm (#3542): `OVERLAP_LOCK` only blocks concurrent runs; `force=1` bypasses hours gate with no rate floor. |
| **Fix** | `RERUN_COOLDOWN_KEY` + 60s TTL via `sharedCacheSetNx` before overlap lock — below 4 min rth-warm-leader heal threshold. |
| **Tests** | `zerodte-warm/route.test.ts` — source-shape + behavioral NX test. |
