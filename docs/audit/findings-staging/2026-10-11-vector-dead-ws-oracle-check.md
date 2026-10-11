## Vector `vectorHasWsOracle` — dead, already-named replacement is the real path — FIXED

> **kind:** `FINDING`

| **Status** | Fixed in PR (fix/vector-dead-ws-oracle-check) |
|---|---|

**Symptom:** none live — pure dead code found during a routine DISCOVERY-lane sweep, not a
production defect.

**Root cause:** `vectorHasWsOracle` (`src/features/vector/lib/vector-ticker.ts`) checked the
STATIC `VECTOR_ORACLE_TICKERS` set (SPX/SPY/QQQ) and was already marked `@deprecated Use
hasLiveGexStrikeExpiry from uw-socket.ts — dynamic subscription means ANY ticker can have a live WS
oracle, not just the static set`. The real replacement is confirmed live with real callers across
`gex-heatmap/route.ts`, `spx-desk.ts`, `vector-wall-sample-server.ts`, `vector-snapshot.ts`,
`gex-positioning.ts`, and `spx-odte-uw-ladder.ts`.

**Evidence:** `grep -rn "\bvectorHasWsOracle\b" --include=*.ts --include=*.tsx src scripts` → only
the definition and its own direct unit test, before the fix.

**Fix:** Removed `vectorHasWsOracle`. `VECTOR_ORACLE_TICKERS` (the set it read) has many other real
callers (`vector-snapshot.ts`, `vector-wall-sample-server.ts`, `vector-wall-sample.ts`,
`vector-cadence.ts`, `vector-rail-bootstrap.ts`, `vector-client-seed.ts`) and is untouched. Removed
its import and direct test assertions from `vector-ticker.test.ts`.

**Fix rationale:** Pure deletion — the function's own doc comment already named the replacement and
the reason to prefer it; nothing called the deprecated version.

**Blast radius:** `src/features/vector/lib/vector-ticker.ts`,
`src/features/vector/lib/vector-ticker.test.ts` only.

**Regression guard:** `vector-ticker.test.ts` 6/6 pass (Node 20,
`--experimental-test-module-mocks`). `tsc --noEmit` clean.
