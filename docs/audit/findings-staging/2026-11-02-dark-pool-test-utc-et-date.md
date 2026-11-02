# Dark pool WS tests used UTC calendar date vs ET session — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |

## What broke

`verify` on `main` @ `1c760ad54` failed two tests:

- `normalizeDarkPoolWsPayload scopes to onlyTicker…` — `undefined !== 2` (unfiltered snapshot null)
- `readUwDarkPoolFromRedis falls back…` — result null

Both used `new Date().toISOString().slice(0, 10)` (UTC date) for synthetic `executed_at` prefixes while production filters on `todayEt()` (America/New_York). After 00:00 UTC while still prior ET session date, every print is dropped.

## Fix

Use `todayEt()` from `src/lib/et-date.ts` in `uw-ws-normalize.test.ts` and `uw-ws-cache-bridge.test.ts`.

## Verify

`npx tsx --test src/lib/providers/uw-ws-normalize.test.ts src/lib/uw-ws-cache-bridge.test.ts` GREEN.
