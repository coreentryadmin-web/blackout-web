> **kind:** FINDING

## Thermal compare-grid batch endpoint: one ticker's upstream failure 500s the whole batch — FIXED

**Status:** Fixed, regression test added (`src/app/api/market/gex-heatmap/batch/route.test.ts`).

### Root cause

`GET /api/market/gex-heatmap/batch` (the Thermal compare-grid's one-round-trip read for up to
`THERMAL_COMPARE_PRESET_SIZE` (7) tickers) fanned out per-ticker work inside a bare `Promise.all`,
with **no try/catch anywhere in the route** — unlike its sibling single-ticker route
(`src/app/api/market/gex-heatmap/route.ts`), which wraps its whole handler body in
`try { ... } catch (error) { return { available: false } }` specifically so an upstream failure
degrades to an honest empty state instead of a 500 (see that route's own comment: "Unify the
'no data' contract ... so the client renders its graceful empty state instead of a 502 red
banner").

The batch route never got the same treatment. Each per-ticker closure called
`loadHeatmapCacheReaderOnly(ticker, forceRefresh)` (`src/lib/gex-heatmap-member-serve.ts`) directly.
That function's `forceRefresh` branch awaits `fetchGexHeatmap(ticker, { forceRefresh: true })` with
**no `.catch()`** — only its *timeout* branch has a fallback (serve the last cached snapshot); a
genuine upstream rejection (a Polygon chain-fetch error, a thrown error deep in
`buildGexHeatmapUncached`'s own fan-out, etc.) propagates straight out of `loadHeatmapCacheReaderOnly`
uncaught.

In the single-ticker route that rejection lands in the route's own top-level `catch` and becomes a
clean `{ available: false }` 200. In the batch route it had nowhere to land: `Promise.all` rejects
on the FIRST rejected member, so one bad ticker (out of up to 7, `force=1` is the Thermal manual
↻ button's own request shape) tore down the whole response — discarding every OTHER ticker's
already-successful read along with it, and (because nothing in this route ever catches it) bubbling
up as an unhandled rejection / framework-level error for the entire grid instead of the
single-ticker route's graceful degradation.

### Evidence

New test `src/app/api/market/gex-heatmap/batch/route.test.ts` mocks
`loadHeatmapCacheReaderOnly` to reject for one ticker while resolving normally for another, then
calls the real route handler.

- **RED (before the fix):** `GET` with `tickers=GOOD,BAD` rejected the whole request —
  `assert.equal(res.status, 200)` never ran; the test failed with the raw
  `Error: upstream chain fetch failed for BAD` escaping out of the route (see the full stack in the
  test run: `loadHeatmapCacheReaderOnly -> route.ts:73 -> Promise.all -> GET`). A second RED case
  (`BAD1,BAD2`, both rejecting) failed identically.
- **GREEN (after the fix):** both cases return `200` — `GOOD`/`AAA`/`BBB` are present in
  `body.tickers`, `BAD`/`BAD1`/`BAD2` are cleanly omitted (same "omitted, not fabricated" contract
  `memberPayloadFromHeatmap(null)` already gives a null/empty heatmap) — and a third test confirms
  the all-healthy happy path is unaffected (3/3 pass).
- `npx tsc --noEmit` clean.
- `npx eslint` on both touched files: 0 errors/warnings.
- Sibling suite `src/app/api/market/gex-heatmap/route.test.ts` re-run alongside the new test:
  19/19 pass, no regression.

### Blast radius

Single route: `src/app/api/market/gex-heatmap/batch/route.ts`. Its only two real-code call sites
are Thermal's compare-grid panel (which the route's own doc comment names as its purpose) — no
other route reuses this file's `Promise.all` fan-out. `memberPayloadFromHeatmap` and
`loadHeatmapCacheReaderOnly` themselves are shared with the single-ticker route, but that route
already had its own top-level catch and needed no change here.

### Fix rationale

Wrapped each per-ticker closure in its own `try/catch`, mirroring the single-ticker route's
existing "any error degrades to an honest absence" contract but applied per-ticker instead of
per-request — the right granularity for a route whose whole point is serving N independent
tickers in one trip. On catch, logs the error (`console.error`, matching the single-ticker route's
own logging) and returns `[ticker, null]`, which the existing output loop already treats as "omit
this ticker" (`if (payload) tickersOut[ticker] = payload`) — no new omission path was invented,
just reached from a failure as well as from a genuinely-empty heatmap. Considered adding a
`.catch(() => null)` directly on `loadHeatmapCacheReaderOnly`'s own `fetchGexHeatmap` call inside
`gex-heatmap-member-serve.ts` instead, but that function's return type is `GexHeatmap | null` and a
caller elsewhere (the single-ticker route) already has its own catch-all around it — swallowing
there would also suppress the exact signal this route's `console.error` now surfaces, and would
widen a shared, lower-level helper's contract based on one caller's gap. Fixing it at the batch
route's own call site keeps the blast radius to the one route that actually lacked protection.

### Deliberately left unchanged

- `loadHeatmapCacheReaderOnly`/`fetchGexHeatmap` themselves — not modified; the fix adds isolation
  at the batch route's call site instead of changing the shared helper's error contract.
- The single-ticker route — already correct, used only as the reference pattern this fix matches.
- `peekGexHeatmapCache`/`joinGexStrikeExpiryTicker`/`registerVectorUniverseView` calls inside the
  same per-ticker block — now also covered by the same try/catch (any of them throwing is just as
  isolating a failure as `loadHeatmapCacheReaderOnly` itself), but none of them are known to throw
  today; the fix is a safety net for the whole per-ticker unit, not a targeted patch of one call.
