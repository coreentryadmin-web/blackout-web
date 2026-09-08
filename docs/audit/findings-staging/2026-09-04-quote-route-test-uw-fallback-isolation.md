# /api/market/quote negative-cache test flakes on a real UW network call

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Test infra / `/api/market/quote` |
| **Severity** | P2 |

## Symptom

`src/app/api/market/quote/route.test.ts`'s "a second poll within the negative-cache window does
NOT re-hit the upstream or re-warn" test failed intermittently — `warnCalls.length` was 1 where the
test expected 0. Reproduced identically on a clean `origin/main` checkout (not something introduced
by any in-flight branch), both in isolation and inside the full suite.

## Root cause

The GET handler's fallback path (`resolveSpotFromUwStockState`, reached after `getRestQuote`
returns `null`) was never mocked in this test file. On a failing ticker it makes a REAL call to
`fetchUwStockState()` (`unusual-whales.ts`), which goes through the real UW rate limiter. That
limiter can log its own unrelated `"[uw] queue wait <ms>ms"` warning (the observability PR #3759
added) — and because the real network round-trip + queue wait ran for ~2.3s, well past the
duration of the test whose `console.warn` override captured it, the warning landed inside whichever
LATER test in the file still had its own `console.warn` override installed, failing an assertion
about a warning the test itself never triggered.

This is a test-isolation bug, not a defect in the Polygon REST negative-cache logic the test is
actually meant to verify — `getRestQuote`'s own negative cache (confirmed via targeted
instrumentation) correctly skipped the second upstream call and did not re-warn.

## Fix

Mock `../../../../lib/providers/spot-fallback`'s `resolveSpotFromUwStockState` to `async () =>
null`, same convention as the file's other `mock.module()` calls. Removes the real network call
entirely, so the suite tests only what it documents testing.

## Evidence

4/4 tests pass, deterministic across 3 consecutive runs (previously flaked). Test duration dropped
from ~2.6s to ~50ms (confirms the real network round-trip was in the critical path).
`tsc --noEmit` clean.

## Blast radius

Test-only change — no production code touched. Left unfixed as a documented follow-up (separate
from this PR, since `resolveSpotFromUwStockState` has other callers — `polygon-options-gex.ts`,
`socket-cluster-health.ts`): the UW fallback path itself has NO negative cache the way the sibling
Polygon REST path does (`quoteFailureMem`/`QUOTE_FAILURE_CACHE_MS`) — a persistently-failing ticker
polled at the desk's ~1.5s cadence would re-hit the real UW rate limiter, with its real retry/backoff
cost, on every single poll. Worth a dedicated look, not folded into this test-isolation fix.
