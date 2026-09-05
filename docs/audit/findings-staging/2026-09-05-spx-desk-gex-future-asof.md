# SPX desk GEX false-fresh on future `as_of`

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-0108 |
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | SPX desk canonical GEX path (`spx-desk.ts`) |

## Symptom

Canonical GEX snapshot age used `Math.max(0, Date.now() - asofMs)` before `gexStaleFromAge()`. A clock-skewed future `pos.asof` produced age `0`, so `gex_stale: false` while data was untrustworthy — same failure class as #3823 (quote cache) and #3824 (0DTE board).

## Fix

- `deskGexRawAgeMs()` / `deskGexDisplayAgeMs()` in `spx-desk-numerics.ts`
- Pass **raw** age to `gexStaleFromAge()`; clamp only `gex_age_ms` for display
- `gexDataAgeMs()` no longer clamps with `Math.max(0, …)`

## Tests

- `src/features/spx/lib/spx-desk-rounding-stale.test.ts` — future-as_of regression
