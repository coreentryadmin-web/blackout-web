# `data-integrity-checks.ts` C6 GEX freshness read future-dated `asof` as trustworthy — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/data-integrity-checks.ts` — C6 heatmap freshness during RTH (`runDataIntegrityChecks`) |
| **Severity** | P3 — audit/incident surface, not member-facing. Same bug class as `data-integrity-verifier.ts` `ageMin()` fix earlier same day |
| **Found by** | Hourly autonomous wake pattern scan, 2026-09-04 |

## Root cause

C6 computed `ageMin = (now - new Date(pos.asof).getTime()) / 60000` with no future guard.
A clock-skewed or corrupted future `asof` produced a negative age that never exceeded the
`> 15` stale threshold — the matrix silently passed as fresh while the data-integrity cron
would not open an incident.

## Fix

Reuse the already-fixed `ageMin()` from `data-integrity-verifier.ts` (returns `Infinity` when
`asof` is beyond `ZERODTE_MARK_FUTURE_TOLERANCE_MS`). Future/invalid timestamps now flag
`GEX {SPX|SPY} stale during RTH` with an explicit future-dated detail string.

## Evidence

`src/lib/data-integrity-checks.test.ts` — future asof RED pre-fix / GREEN post-fix.
