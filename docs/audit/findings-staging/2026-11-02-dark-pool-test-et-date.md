# 2026-11-02 verify — dark pool tests used UTC calendar date vs todayEt()

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 CI |

## What broke

`verify` on `1c760ad5` failed `normalizeDarkPoolWsPayload scopes to onlyTicker` and `readUwDarkPoolFromRedis falls back…` — prints used `new Date().toISOString().slice(0,10)` (UTC) while production filters on `todayEt()` (America/New_York). After midnight UTC while still prior ET session date, all prints were dropped → null snapshots.

## Fix

Use `todayEt()` + same-day UTC instants in `uw-ws-normalize.test.ts` and `uw-ws-cache-bridge.test.ts`.

## Verify

`npx tsx --test src/lib/providers/uw-ws-normalize.test.ts`
