# verify RED: dark-pool tests used UTC calendar date vs ET filter

> **kind:** FINDING

| **Status** | FIXED (pending merge) |

## Symptom

`main` verify failed (41366602528 @ `1c760ad54`):

- `normalizeDarkPoolWsPayload scopes to onlyTicker` — `undefined !== 2`
- `readUwDarkPoolFromRedis falls back...` — null discarded as empty

## Root cause

Both tests built `executed_at` with `new Date().toISOString().slice(0, 10)` (UTC date).
Production normalizers filter on **`todayEt()`** (America/New_York). After 00:00 UTC while ET
is still prior session date, all prints are dropped → null snapshots.

## Fix

Use `todayEt()` from `et-date` in both tests.

## Verify

`uw-ws-normalize.test.ts` + `uw-ws-cache-bridge.test.ts` green on CI timezone boundary.
