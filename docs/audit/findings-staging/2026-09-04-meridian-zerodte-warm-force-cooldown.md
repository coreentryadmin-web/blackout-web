## 2026-09-04 — [FINDING, P3 Performance] meridian-warm and zerodte-warm missing force=1 cooldown — FIXED

> **kind:** `FINDING`

| Field | Value |
|---|---|
| **Status** | FIXED |
| **PR** | (this branch) |

### Root cause

Same structural gap as desk-warm (#3540) and heatmap-warm (#3542): `OVERLAP_LOCK` only blocks concurrent runs and releases on completion; `force=1` bypasses the hours gate with no replay floor.

### Fix

- `meridian-warm`: `RERUN_COOLDOWN_KEY` with 120s TTL (below 5min heal threshold)
- `zerodte-warm`: `RERUN_COOLDOWN_KEY` with 90s TTL (below 4min heal threshold)

Mirrors the atomic `sharedCacheSetNx` pattern from #3540/#3542.

### Tests

`meridian-warm/route.test.ts` and `zerodte-warm/route.test.ts` — source-text ordering assertions + behavioral `sharedCacheSetNx` refusal test each.
