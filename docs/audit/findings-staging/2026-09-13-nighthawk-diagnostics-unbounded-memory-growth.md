> **kind:** FINDING

## `globalDiagnostics` singleton grew unbounded forever — a real, live memory leak — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk shared infra — `nighthawk/lib/diagnostics.ts`, hit via `src/lib/providers/polygon-largo.ts` |
| **Severity** | P2 (unbounded memory growth in a long-running ECS container, platform-wide, not Legacy-specific) |
| **Found by** | Night Hawk Legacy standing audit mandate (general performance/latency sweep), 23:21 UTC cycle, 2026-09-13 |

### Root cause

`diagnostics.ts` exports a module-level singleton, `globalDiagnostics` (a `DiagnosticsCollector`
instance), meant to record a "comprehensive troubleshooting trail at every layer" so "every 0-play
outcome is self-diagnosing." Its `recordDataSourceing`/`recordGateRejection` methods `push()`
unconditionally onto `this.trails`/`this.gateRejections` with **no cap, no eviction, and no reset**.

Two facts combine into a real leak:

1. **Nothing in production ever reads it.** `globalDiagnostics.summary()` — the only method that
   returns the accumulated arrays — has zero call sites outside `diagnostics.test.ts` (confirmed
   via repo-wide grep). The collector was built for a consumer that was never wired up.
2. **It IS actively written on a hot path.** `recordDataSourceing` is called **3x per ticker** from
   `src/lib/providers/polygon-largo.ts`'s `fetchPolygonMtfTechnicals` (price resolution, technical
   indicators, ATR14 resolution) — a shared stock-technicals fetch used across Night Hawk products
   (0DTE, Legacy, Swings all read through this provider), invoked for every ticker on every build/
   scan.

So `this.trails` grows by 3 entries per ticker per fetch, forever, for the life of the ECS
container, with nothing ever draining it — a genuine, confirmed unbounded memory leak, not a
theoretical one.

### Evidence

- Grep confirms `globalDiagnostics.summary(` has exactly two call sites, both inside
  `diagnostics.test.ts`.
- Grep confirms `recordDataSourceing` is called from `polygon-largo.ts:377,404,439` inside
  `fetchPolygonMtfTechnicals`, which is the shared multi-timeframe-technicals fetch.
- New regression tests in `diagnostics.test.ts`: push `MAX_DIAGNOSTIC_TRAILS + 50` /
  `MAX_GATE_REJECTIONS + 50` entries and assert the retained count never exceeds the cap and the
  most-recent entries survive (RED before the fix — unbounded growth, no cap existed at all; GREEN
  after).

### Blast radius

Single collector class, two record methods, one production caller chain (`polygon-largo.ts` →
every Night Hawk product that resolves a ticker's technicals). Not Legacy-specific — flagged and
fixed here because it was found during the Legacy lane's general performance-sweep pass, but the
fix benefits every product reading through `fetchPolygonMtfTechnicals`.

### Fix rationale

Bounded both `trails` and `gateRejections` to a 2000-entry ring buffer (oldest evicted first via
`splice`) rather than removing the collector or its call sites entirely — the original
"self-diagnosing" intent is real and worth preserving for whoever eventually wires up a consumer;
capping just stops it from leaking memory in the meantime. `rejectionCounts` (the `{gate: count}`
map) was deliberately left uncapped: its cardinality is bounded by the small, fixed number of
distinct gate names, not by call volume, so it cannot grow unbounded the way the two arrays did.

Considered instead: deleting the whole collector as dead weight since nothing consumes it.
Rejected — `recordDataSourceing`'s calls in `polygon-largo.ts` are live, intentional
instrumentation with real diagnostic value (the price-resolution/indicator/ATR14 fallback-chain
detail), and removing them would lose that trail entirely rather than just fixing its memory
behavior.

### Verification

- New tests RED before fix (no cap existed — both new assertions failed on an `undefined` cap
  constant) / GREEN after.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): 14123 pass / 0 fail.
