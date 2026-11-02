# verify RED — dark pool tests used UTC date vs ET session filter — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## What broke

`verify` on `1c760ad` failed `uw-ws-normalize.test.ts` (onlyTicker scope) and `uw-ws-cache-bridge.test.ts` (Redis fallback) — fixtures used `new Date().toISOString().slice(0, 10)` (UTC) while production filters on `todayEt()`.

## Root cause

After midnight UTC but still prior ET session date, prints were dropped → `normalizeDarkPoolWsPayload` returned null.

## Fix

Use `todayEt()` from `@/lib/et-date` in both test fixtures.

## Verify

- `node --import tsx --test src/lib/providers/uw-ws-normalize.test.ts src/lib/uw-ws-cache-bridge.test.ts`
