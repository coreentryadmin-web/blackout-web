# SPX desk collapses to an empty shell (price:0, available:false) instead of a real last-close, because the I:SPX price-resolution chain has no cross-ticker (SPY-proxy) fallback

> **kind:** `FINDING`

### Summary
`GET /api/market/spx/desk` and `/api/market/spx/play` (both backed by `buildSpxDesk()`,
`src/features/spx/lib/spx-desk.ts`) returned a full empty shell — `price:0`, `available:false`,
`source:"none"`, zero factors, `gates.blocks:["Session closed"]` — confirmed live 2026-11-09 across
five sibling SPX routes at the same instant, with `as_of === polled_at === request time`, proving
this was a fresh build attempt, not a stale cache. At the same moment, `GET /api/market/gex-heatmap?ticker=SPX`
returned a real `spot:7352.9` — exactly SPY's real close (735.29, confirmed directly against
Polygon) × 10. Direct Polygon/Massive calls with the real production key confirm the exact root
cause: `GET /v2/aggs/ticker/I:SPX/prev` and `/range/1/day/...` both return `403 NOT_AUTHORIZED`
("not entitled... upgrade your plan"), while the equivalent `SPY` aggs calls return `200 OK`. This
is an **additional, previously-undocumented scope** of the known Polygon entitlement loss
(CLAUDE.md currently records only `/v3/snapshot` real-time and Benzinga) — the I:SPX-specific
historical-aggs family is also blocked, while the equivalent stock aggs stay healthy.

The net effect: SPX Slayer's entire desk, trade-alert panel, and **Ask Largo's `get_spx_confluence`
tool** (which reads off this same `buildSpxDesk`/`computeSpxConfluence`) go fully dark whenever this
specific entitlement gap is active — in a situation where a sibling feature in the same codebase
(`gex-heatmap`) stays usefully alive with a real number, because it already has the fix this one
never got.

### Root cause
`src/lib/providers/polygon-options-gex.ts`'s `resolveSpotSnapshotLastResort` (lines ~1299-1316)
already implements exactly this fallback for exactly this condition — its own in-code comment:
*"I:SPX prev is often plan-gated; SPY prev × 10 tracks within ~0.4% (data-integrity C4)."* This is
why `gex-heatmap` recovered a real spot while `spx-desk.ts` did not.

`buildSpxDesk()`'s own price-resolution chain —
`const price = spxSnap?.price ?? lastPulseForSignals?.price ?? priorFromBars.pdc ?? 0;` — has no
equivalent. `spxSnap` comes from `fetchIndexSnapshots` (the blocked `/v3/snapshot/indices`
family); `priorFromBars.pdc` comes from `fetchIndexDailyBars(SPX, ...)` (the newly-confirmed-
blocked `I:SPX` aggs family); `lastPulseForSignals` is an in-memory, per-process variable, cold on
a freshly-built/replica process. When all three are unavailable, the chain falls straight through
to `0`, and `if (!(price > 0)) return empty;` serves the full degraded shell — the exact
"platform-integrity FAIL vs gex-heatmap" scenario this file's own historical comments explicitly
name as the anti-goal, just never fully closed for this specific entitlement-block path.

### Fix
Added `spxPriceFromSpyProxy()` — a direct port of the proven `gex-heatmap` pattern: fetches SPY's
previous-day close via `fetchPreviousDayBar` and scales ×10. Wired into `buildSpxDesk()`'s price
chain as the last resort before `0`, only invoked (the `??` chain short-circuits) when
`spxSnap`/`lastPulseForSignals`/`priorFromBars.pdc` are all genuinely unavailable — never spends
the extra fetch otherwise. Price-only, matching the precedent's own scope exactly: never
fabricates `pdh`/`pdl`/`change_pct`/`prior_close`, which a single SPY close cannot supply
honestly — those stay correctly null/absent when only the proxy resolved.

### Evidence
- RED: 2 tests fail against pre-fix source (`git stash` of just `spx-desk.ts`): 14/16 pass.
- GREEN: 16/16 pass post-fix, including one pre-existing test whose literal source-text regex
  needed updating to match the new (longer) price-chain shape — not a behavior regression, the
  old regex just no longer matched the extended chain.
- Full `src/features/spx/lib/*.test.ts` regression: 951/951 pass.
- `npx tsc --noEmit` clean project-wide.

### Blast radius
Only `buildSpxDesk()` (the full desk builder used by `/api/market/spx/desk`, `/play`, and Ask
Largo's `get_spx_confluence` tool). **Deliberately NOT fixed in this PR**: `buildSpxDeskPulseMinimal()`
and `buildSpxDeskPulse()` (the two faster pulse-lane builders, `/api/market/spx/pulse`) — both
carry an explicit, documented "sub-500ms, never block cold" latency contract
(`buildSpxDeskPulseMinimal`'s own doc comment), and adding a network fetch directly into either
would violate that contract. Fixing them safely requires integrating the SPY-proxy fetch into
their existing background-refreshed cache machinery (`cachedPriorDay`/`fetchPriorDayCached`)
rather than an inline `await`, which is more involved and is left as a disclosed follow-up rather
than risking a latency regression on a fast lane to close this specific gap. Severity P2 — SPX
Slayer's primary desk + the Ask Largo SPX tool reading zero/empty data during a real entitlement
outage window, not merely a cosmetic staleness issue.

| **Status** | FIXED (partial — buildSpxDesk only; pulse-lane builders disclosed as follow-up) — this PR. |
