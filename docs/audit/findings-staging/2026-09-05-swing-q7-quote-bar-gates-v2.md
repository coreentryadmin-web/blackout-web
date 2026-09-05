# 2026-09-05 — Swing Q7 P4: wire quote_stale + daily_bar_incomplete into V2 commit path

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | Swing Engine V2 commit gates (`v2/gates.ts`, `commit.ts`, `discovery.ts`) |
| **Status** | FIXED |

## Symptom

Deep-dive Q7: legacy `evaluateSwingGates` implemented `quote_stale` and `daily_bar_incomplete` as WATCH-level structural blocks, but the module had zero production callers. V2 commit (`commit.ts` + `v2/gates.ts`) wired G-S3/G-S6/G-S12/G-S14 but not these two checks — stale quotes or open-session reference bars could COMMIT.

## Fix

- `v2/gates.ts` — `evaluateQuoteStaleGate` + `evaluateDailyBarGate` with tokens `gate:quote_stale` / `gate:daily_bar_incomplete`.
- `v2/config.ts` — `isSwingQuoteStaleGateEnforced` / `isSwingDailyBarGateEnforced` (LIVE when V2 on, opt-out via env).
- `commit.ts` — gates 0.61/0.62; shadow-eligible block reasons extended.
- `discovery.ts` — plumbs `quoteAgeMs` from contract `quoteUpdatedMs` when present; `dailyBarComplete = !isEtCashRth(now)`.
- `ChainContract.quoteUpdatedMs` via `chainContractFromSnapshot`.

Unknown quote age fails open (matches legacy null handling).

## Evidence

- `v2/gates.test.ts`, `v2/config.test.ts`, `commit.test.ts`

## RTH validation

- POST_CLOSE discovery: commits should proceed when quotes fresh and session bar closed.
- Midday scan (if enabled): `daily_bar_incomplete` should block COMMIT during cash RTH.
