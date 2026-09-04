> **kind:** `FINDING`

## zerodte-service.test.ts silently made real network/DB calls, causing 5 flaky failures and 13x slower runtime — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (test-suite reliability + CI/dev-loop performance, not a production defect) |
| **File** | `src/lib/platform/zerodte-service.test.ts` |
| **Found while** | Investigating 5 failures surfaced by a full `npm test` run on `main` during the standing audit sweep, 2026-09-04 |

### Root cause

This test file's own header claims: "Hermetic payload tests (mock.module, RELATIVE specifiers...)" — the design intent is that every test in the file runs with zero real IO, deterministic regardless of environment. In practice `buildZeroDteBoardPayload()` (the function under test) calls three unmocked dependencies unconditionally:

1. `fetchZeroDteSessionContext()` (`@/lib/zerodte/entry-context`) — fetches real Polygon VIX/SPY bars via `polygon-largo.ts`.
2. `fetchDiscoveryFunnelHint()` (`@/lib/zerodte/discovery-funnel-hint`) — dynamically imports `@/lib/db` and queries it.
3. `fetchZeroDteVectorPulseByTicker()` (`@/lib/zerodte/vector-crosslink`) — reads `@/lib/vector/vector-pick-leaders-db`.

None of the three were in this file's `mock.module(...)` block, so every test silently attempted real network/DB IO. In this sandbox, `POLYGON_API_BASE` resolves to a disallowed host (fails fast) and the Postgres calls hang out a real connection timeout (~10s each: `getaddrinfo ENOTFOUND postgres.railway.internal` / `Connection terminated due to connection timeout`).

This alone would just be slow — but `zeroDtePlaysForLargo()` calls `getZeroDteBoardPayload()`, which races the cold board-build against `zerodteBoardMaxBlockMs()` (default **3000ms**) and falls back to `buildMinimalBoardFallback()` (`upstream_ok: false`, empty `ledger`/`setups`) if the build doesn't finish in time. Since the real DB timeout alone (~10s) vastly exceeds the 3s race window, **every test that calls `zeroDtePlaysForLargo()` always lost that race** and got the structurally-empty fallback — which then made `zeroDtePlaysToolEnvelope()` return `available: false` with **no `plays` key at all**, so `largo.plays` was `undefined` in the test. Tests that instead call `buildZeroDteBoardPayload()` directly (bypassing the race) just ran ~10-13s slower per test but still eventually produced correct data — which is exactly the asymmetry observed: 5 failures, all and only in tests calling `zeroDtePlaysForLargo()`; every `buildZeroDteBoardPayload()`-only test passed, just slowly.

### Evidence

- Confirmed by direct code read: `buildZeroDteBoardPayload()` (`zerodte-service.ts` ~line 676) awaits `fetchZeroDteSessionContext().catch(() => null)` in the same `Promise.all` as the mocked ledger read; `fetchDiscoveryFunnelHint(today).catch(...)` (~line 702) and `fetchZeroDteVectorPulseByTicker(today, boardTickers).catch(...)` (~line 759) are both called unconditionally.
- `zerodteBoardMaxBlockMs()` (`src/lib/providers/config.ts`) defaults to 3000ms — far below the ~10s real-connection-timeout cost these three calls incurred.
- RED (before fix): `node --import tsx --experimental-test-module-mocks --test src/lib/platform/zerodte-service.test.ts` → 17 pass / **5 fail** (all 5 in tests calling `zeroDtePlaysForLargo()`, all failing with `largo.plays` being `undefined`/`.map` on `undefined`, or an actual value coming back `null`), **151s** total runtime.
- GREEN (after mocking all three call sites to their own already-`.catch()`-handled fallback shapes — `null`, `null`, `{}` respectively): **22/22 pass**, **11.9s** total runtime (a 13x speedup — each mocked call was previously wasting a real ~10s timeout per test, times ~15 tests in the file).
- `npx tsc --noEmit` clean.

### Fix

Added three `mock.module(...)` registrations to the existing mock block, each returning the EXACT fallback shape the real call site already treats a failure as (`fetchZeroDteSessionContext` → `null`, matching its own `.catch(() => null)`; `fetchDiscoveryFunnelHint` → `null`, matching its own `.catch(() => null)`; `fetchZeroDteVectorPulseByTicker` → `{}`, matching its own `.catch(() => ({}))`). No production code changed — this is purely a test-hermeticity fix.

### Blast radius

Single test file. Confirmed each mocked module exports only the one named export `zerodte-service.ts` actually imports from it (checked against the real import lines), so replacing the whole module's `namedExports` doesn't silently undefine anything else the file under test needs.

### What was deliberately left unchanged

Two residual `[db]` connect-failure log lines still print AFTER all 22 tests report done (a fire-and-forget background call settling post-hoc) — non-blocking, doesn't affect pass/fail or the measured 11.9s runtime, not chased further. No production code — `zerodte-service.ts`, `entry-context.ts`, `discovery-funnel-hint.ts`, `vector-crosslink.ts` — was touched; the real functions still make real calls in production exactly as before.
