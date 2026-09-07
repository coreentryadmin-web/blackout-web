# data-integrity-checks C6 — future-skewed GEX asof bypassed RTH stale flag — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-data-integrity-gex-future-skew |
| **Pri** | P2 |
| **Area** | data-correctness / cron data-integrity |
| **Status** | FIXED (PR pending) |

## Symptom

During RTH, `runDataIntegrityChecks()` C6 computed `ageMin = (now - asof) / 60000` without the
future-skew guard already used by `data-integrity-verifier.ts`'s `ageMin()`. A clock-skewed future
`pos.asof` produced a **negative** `ageMin` that never exceeded the 15-minute stale band — the cron
silently passed a corrupt/future matrix as fresh while the verifier's redis_gex layer would have
flagged it.

## Fix

- Extract `gexMatrixRthAgeMin` / `gexMatrixStaleDuringRth` in `src/lib/data-integrity-gex-freshness.ts`
  (reuses verifier `ageMin()` → `Infinity` beyond 60s future skew).
- C6 in `data-integrity-checks.ts` now calls the shared helper — aligned with verifier's 15m RTH band.

## Evidence

`npx tsx --test src/lib/data-integrity-gex-freshness.test.ts` — future asof `+10m` → stale (not fresh).

## RTH check

At open: if admin data-integrity cron fires with a stuck GEX cache carrying future `asof`, C6 should
open a `GEX SPX stale during RTH` warning (not pass clean).
