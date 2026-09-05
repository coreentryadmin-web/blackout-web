# SPX desk future-timestamp staleness gap + anomalies API roundFloats

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P1-0106 |
| **Status** | FIXED |
| **Severity** | P1 (desk staleness) / P2 (anomalies rounding) |
| **Area** | SPX play engine, admin health, market anomalies API |

## Symptom

1. **SPX open-play management** used `deskAgeSec()` without a future-timestamp guard. A `polled_at`/`as_of` stamped more than 60s in the future (real cross-process clock skew between desk warm cron and play engine) produced a negative age, which `isDeskStale()` treated as "not stale". Price-driven exits (stop/target/trail/MFE/MAE) could run off an unverified desk quote. The entry gate in `spx-play-gates.ts` already had this guard; the open-play path did not.

2. **`GET /api/market/anomalies`** returned raw Postgres `premium` floats without `roundFloats`, unlike sibling market routes.

## Evidence

- Pattern scan during hourly wake (2026-09-05): `deskAgeSec` at `spx-desk-stale.ts:21` vs guarded path at `spx-play-gates.ts:287-297`.
- `admin-spx-health.ts` shared the same unguarded helper → false-negative stale tile on clock skew.

## Fix

- `deskAgeSec(..., staleMaxSec?)`: when age &lt; -60s tolerance, return `staleMaxSec + 1` (fail closed).
- Callers (`spx-play-engine.ts`, `admin-spx-health.ts`) pass `playGexStaleMaxSec()`.
- `anomalies/route.ts`: wrap GET response with `roundFloats`.

## Tests

- `src/features/spx/lib/spx-desk-stale.test.ts` — future skew fails closed; within-tolerance skew still live.
- `src/app/api/market/anomalies/route.test.ts` — source scan for roundFloats boundary.

## Market-open validation

- Admin → SPX health panel: confirm `desk.stale` matches play-engine behavior when desk cache is warm.
- Open SPX play during RTH: verify price exits do not fire when desk lane shows stale/future-skewed timestamp.
