> **kind:** FINDING

## `fetchPolygonMacroBackdrop` cached a one-sided fetch FAILURE as a confirmed-empty macro leg for a full hour — FIXED

| | |
|---|---|
| **Area** | `src/lib/providers/polygon-macro.ts` (consumed by `src/lib/bie/ecosystem-context.ts` + `src/lib/bie/verdict.ts` — the synthesis engine's macro backdrop) |
| **Severity** | P2 — a transient, one-sided upstream outage (429/5xx/network error on either `/fed/v1/treasury-yields` or `/fed/v1/inflation`) silently nulls a real, available macro series for every consumer for up to an hour, with no error surfaced anywhere |
| **Status** | FIXED |

### Root cause

`fetchPolygonMacroBackdrop` fetches two independent Polygon/Massive series under one
`Promise.all`, each guarded by its own `.catch`:

```ts
const [treasury, inflation] = await Promise.all([
  macroGet(...).catch(() => ({ results: [] })),
  macroGet(...).catch(() => ({ results: [] })),
]);
```

`macroGet` throws on ANY non-2xx response (including `429` and `5xx`) or a network-level
exception — it never returns a "soft" empty result on its own. So the `.catch(() => ({results:
[]}))` on each leg collapses a **genuine fetch failure** into the exact same shape a leg that
**legitimately has nothing to report this period** (e.g. CPI not yet printed) produces — both are
`{ results: [] }}`, indistinguishable from outside the function.

The only gate on whether to cache the result was:

```ts
if (backdrop.treasury.date == null && backdrop.inflation.date == null && backdrop.inflation.cpi == null) {
  throw ...; // don't cache — BOTH legs empty
}
return backdrop; // cached for TTL.REFERENCE = 1 hour
```

This only refuses to cache when **both** legs are empty. A one-sided failure — say,
`/fed/v1/inflation` 500s while `/fed/v1/treasury-yields` succeeds — produces a backdrop with
`treasury.date` populated and `inflation` entirely null, which is **not** caught by the
both-empty guard, so it gets built, returned, and pinned in the shared `serverCache` entry
(`polygon:macro-backdrop:v1`) for the full 1-hour `TTL.REFERENCE` window. Every consumer of
`fetchPolygonMacroBackdrop()` during that hour sees a confidently-null CPI reading that was in
fact never actually checked as "no CPI data this period" — it was a fetch that failed and got
silently reinterpreted as "nothing to report."

### Why this wasn't caught sooner

The function's own doc comment explicitly described this as intended behavior ("a partial read
… IS returned and cached with the missing leg nulled"), conflating two genuinely different cases
under one description: (1) a leg whose fetch **succeeded** but legitimately returned zero rows,
and (2) a leg whose fetch **failed**. Only the pure helper functions (`parseTreasuryYields`,
`parseInflation`, `buildMacroBackdrop`, `pickLatestByDate`) had tests; `fetchPolygonMacroBackdrop`
itself — the function that actually makes the cache-or-not decision — had no test exercising a
fetch failure, so the conflation was never exercised.

This is the same "swallow failure before the combinator, cache the degraded result" bug class
already fixed four times earlier this session (meridian peer-reactions, nighthawk
financials-bundle, meridian OpEx grouped-daily, vector 4h-bars) — reached here via a two-leg
`Promise.all` feeding `serverCache` instead of three-or-more legs or a day-walk loop. A prior
sweep this session had declared `src/lib/providers/**` exhausted for this exact shape
(`serverCache`/`withServerCache`/`peekServerCache` + `Promise.all`); this file is in
`src/lib/providers/` and was missed — per this codebase's own lesson that a "fully exhausted"
declaration for a cross-cutting bug class is never permanent without a fresh grep.

### Fix

Track whether each leg's own fetch threw (`treasuryFetchFailed`/`inflationFetchFailed`), set only
inside that leg's own `.catch`, and refuse to cache (throw, same mechanism as the existing
both-empty guard) whenever either flag is true — regardless of what the other leg did. A leg
whose fetch genuinely succeeded with zero rows is untouched: it still builds and caches a partial
backdrop with that leg nulled, exactly as originally intended. Only the case the old code could
never distinguish — "the fetch itself failed" — now refuses to cache, so the next caller retries
both legs fresh instead of serving a stale, falsely-confident null for up to an hour.

### Blast radius

`fetchPolygonMacroBackdrop` has exactly two consumers, both in `src/lib/bie/`
(`ecosystem-context.ts`, `verdict.ts` — the synthesis engine's macro-backdrop input). Neither
needed any change: both already treat a `null` return from this function as "no macro backdrop
available this cycle," which is the correct behavior for a genuine fetch failure — they were never
told the difference between "genuinely no data" and "fetch failed," and still aren't; this fix
only changes which of those two failure shapes gets a false "confirmed empty" verdict cached for
an hour versus retried on the next call.

Grepped the rest of `src/lib/providers/**`, `src/lib/meridian/**`, `src/lib/helix/**`,
`src/lib/vector/**`, `src/features/thermal/**`, `src/lib/platform/**` for the same
`serverCache(`/`withServerCache(` + `Promise.all(` co-occurrence shape. Found four other
matches: `src/features/spx/lib/spx-desk-loader.ts` and `src/lib/zerodte/scan.ts` sit inside this
session's excluded SPX/0DTE trading-decision directories and were not pursued;
`src/lib/meridian/meridian-sector-classify.ts` wraps EACH ticker's lookup in its own
per-ticker `withServerCache` call (already throw-on-failure, correctly isolated — confirmed
clean, not a second instance); `src/lib/admin-health.ts` is an admin-only diagnostic snapshot,
not member-facing cached data, and was not pursued given the round's time budget — worth a
closer look in a future sweep.

### Evidence (RED → GREEN)

New file `src/lib/providers/polygon-macro-fetch-failure.test.ts` (kept separate from the existing
`polygon-macro.test.ts`, which statically imports the module's pure helpers at file-top-level —
`mock.module()` must run before anything resolves the target module's dependency graph, so mocking
`./polygon-rate-limiter`/`../server-cache` in the same file as that static import would be too
late). Mocks `polygonTrackedFetch` to simulate a genuine HTTP failure on one leg while the other
succeeds with real data, and bypasses the real cache (`serverCache` mocked to just call its
compute function) so each test observes the compute function's own return/throw directly.

Six cases: one-sided treasury failure, one-sided inflation failure, both-failed (pre-existing,
unaffected), one-sided genuine-empty (not a failure — must still cache the partial, unaffected),
both genuinely empty (pre-existing total-miss guard, unaffected), and both succeeding with real
data (full backdrop). Confirmed via `git stash` isolation on `polygon-macro.ts` alone: 2/6 fail
pre-fix (the two genuine-failure cases returned a non-null, falsely-confident partial backdrop
instead of `null`), 6/6 pass post-fix. `npx tsc --noEmit` clean. Full existing
`polygon-macro.test.ts` (pure-function tests) still 8/8 pass, unaffected.
