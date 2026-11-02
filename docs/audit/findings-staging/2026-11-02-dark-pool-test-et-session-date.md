# Dark pool WS tests used UTC calendar date vs ET session filter

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
| --- | --- |

## What broke

`verify` on `main`: `normalizeDarkPoolWsPayload` scoping + `readUwDarkPoolFromRedis` fallback tests failed when UTC date ≠ `todayEt()` (e.g. 00:20 UTC on Nov 2 while ET still Nov 1). Production filters use ET session dates; tests used `toISOString().slice(0,10)`.

## Fix

Use `todayEt()` from `@/lib/et-date` in `uw-ws-normalize.test.ts` and `uw-ws-cache-bridge.test.ts`.

## Verify

`npx tsx --experimental-test-module-mocks --test src/lib/providers/uw-ws-normalize.test.ts src/lib/uw-ws-cache-bridge.test.ts`
