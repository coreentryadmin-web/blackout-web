# Options cluster health — future-skewed mark timestamps read as fresh — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P1-options-cluster-mark-future-skew |
| **Pri** | P1 |
| **Area** | Ops / socket-health |
| **Status** | FIXED |

## Symptom

`readOptionsClusterHealth()` scanned Redis `nw:optmark:*` marks with `Math.max(0, now - mark.ts)`.
Clock-skewed **future** `mark.ts` clamped to age **0 ms**, so `marks_fresh` and `cluster_live`
could read true on web-tier followers even when no trustworthy mark existed — a false-green ops
signal during RTH (same class as #4454 UW/Polygon heartbeat fixes, but this scan path was missed).

## Fix

Extract `youngestFreshOptionMarkAgeMs()` using shared `isWsUpdatedAtFresh` + `wsUpdatedAtAgeMs`
(already used by `getLiveOptionMarkSync`). Future-skewed marks are excluded; only genuinely fresh
marks contribute to `newest_mark_age_ms`.

## Evidence

`npx tsx --test src/lib/ws/socket-cluster-health.test.ts` — future-skew regression passes.
`npx tsc --noEmit`: clean.

| **Status** | FIXED — PR opened, merge pending CI/peer-review |
