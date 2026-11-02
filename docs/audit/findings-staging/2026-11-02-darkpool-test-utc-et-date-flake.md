# Dark pool WS tests used UTC date while filters use ET — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
| --- | --- |

## What broke

`verify` on `main` @ `1c760ad54` (docs-only RUN-LOG commit): two unit tests failed after midnight UTC — `normalizeDarkPoolWsPayload scopes to onlyTicker…` (`undefined !== 2` on `prints.length`) and `readUwDarkPoolFromRedis falls back…` (*a fresh market-wide cache entry must not be discarded as empty*).

## Root cause

Tests built `executed_at` with `new Date().toISOString().slice(0, 10)` (UTC calendar date) while production normalizers filter on **`todayEt()`** (America/New_York). Between 00:00–04:59 UTC (still prior ET session date), all synthetic prints read as wrong-session and are dropped.

## Fix

Use `todayEt()` from `src/lib/et-date.ts` in both test files.

## Verify

`npx tsx --test src/lib/providers/uw-ws-normalize.test.ts src/lib/uw-ws-cache-bridge.test.ts`
