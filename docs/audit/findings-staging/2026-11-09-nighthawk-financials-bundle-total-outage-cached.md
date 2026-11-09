# 2026-11-09: Night Hawk `fetchFinancialsBundle` could cache a total Polygon/Benzinga outage as "no financials data" for a full hour

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`src/features/nighthawk/lib/dossier.ts`'s `fetchFinancialsBundle(sym)` fetches 5 independent
upstream calls (Polygon financial ratios, income/balance/cash-flow statements, Benzinga price
target) and caches the combined bundle on `serverCache(..., TTL.REFERENCE, ...)` — a 1-hour TTL,
deliberately long because financials change slowly. Each of the 5 calls carried its OWN
`.catch(() => null | [])`, applied BEFORE the `Promise.all` that formed the cached loader's body.
Because every individual failure was swallowed at the call site, the `Promise.all` — and
therefore the `serverCache` loader itself — could never reject, no matter how many of the 5
calls actually failed. A correlated failure hitting all 5 at once (a full provider outage, a
shared-credential rate limit, a network blip during a cold start) produced a value
(`{ratios:null, signals:null, priceTarget:null}`) that was byte-identical to a genuinely
successful read of a ticker with no fundamentals data at all — and `serverCache`'s success path
(`server-cache.ts`'s `refreshCache`) wrote it into the cache for the full hour, resetting the
key's failure-tracking (`failureCount`/`degradedKeys`) in the process, since from its point of
view nothing had failed.

Flagged as a specific, named follow-up lead by the previous round (round 494, PR #7773, which
fixed the single-fetch sibling of this exact bug class in `meridian-peer-reactions.ts`) rather
than independently discovered this round — confirmed real by reading the actual code and tracing
`serverCache`'s success/failure branches in `server-cache.ts`.

## Root cause

`fetchFinancialsBundle` (`dossier.ts`, pre-fix):

```ts
async function fetchFinancialsBundle(sym: string): Promise<FinancialsBundle> {
  return serverCache(`nighthawk:financials:${sym}`, TTL.REFERENCE, async () => {
    const [ratios, income, balance, cashFlow, priceTarget] = await Promise.all([
      fetchPolygonFinancialRatios(sym).catch(() => null),
      fetchPolygonIncomeStatements(sym, 6).catch(() => []),
      fetchPolygonBalanceSheets(sym, 6).catch(() => []),
      fetchPolygonCashFlowStatements(sym, 6).catch(() => []),
      fetchBenzingaPriceTarget(sym).catch(() => null),
    ]);
    return { ratios, signals: computeFundamentalSignals(income, balance, cashFlow), priceTarget };
  });
}
```

`server-cache.ts`'s `refreshCache` only calls `setStoreEntry` (writes the cache) and clears
`failureCount`/`degradedKeys` inside the loader promise's `.then()` — i.e. on success. On
rejection it throws straight through without caching anything, and increments the real
failure-tracking instead. Swallowing every individual failure before the `Promise.all` meant that
branch could never be reached here, however bad the real upstream health was — the exact
"absence-as-fact" shape this repo's CLAUDE.md and FINDINGS.md call out repeatedly elsewhere
(Benzinga entitlement loss, empty earnings cohorts, #7773's Meridian peer-reaction cache), just
reached via 5 parallel `.catch()`s instead of one `try/catch` around a single fetch.

Consequence: a ticker that hit this during a transient blip (not necessarily a full outage — any
window where all 5 calls happen to fail, e.g. a correlated timeout) would read as "no fundamentals
data" — no ratios, no revenue/margin/FCF/debt trend, no analyst price target — to every Night
Hawk dossier/scoring consumer for up to an hour, with the cache's own SWR/degraded-key retry
machinery never getting a chance to kick in, since the loader never told it anything had failed.

## Evidence (RED → GREEN)

New pure module `src/features/nighthawk/lib/financials-bundle-core.ts` (no `server-only` import,
directly or transitively — `dossier.ts` itself cannot be unit-tested, since it imports
`./ticker-greek-flow-summary`, which does import `server-only`) exposes
`settledFinancialsOrThrow`, unit-tested in `financials-bundle-core.test.ts` (4 tests).

RED (pre-fix logic, reproduced by temporarily reverting `settledFinancialsOrThrow` to swallow
every `PromiseSettledResult` unconditionally instead of checking for all-rejected, then re-running
the same test file): 1/4 fail — specifically the "all-5-rejected" case, which the old logic
returned as `{ratios:null, income:[], balance:[], cashFlow:[], priceTarget:null}` instead of
throwing.

GREEN (post-fix): 4/4 pass — all-rejected throws, one-success-among-five is treated as a genuine
partial result (unchanged per-field null/[] fallback), all-success is unchanged, and a
genuinely-empty-but-fulfilled read (e.g. a real ticker with no statements at all) is correctly
NOT mistaken for an outage.

`npx tsc --noEmit` clean on Node 20.

## Fix

`dossier.ts`'s `fetchFinancialsBundle` now runs the 5 calls with NO per-call `.catch()` via
`Promise.allSettled`, then calls `settledFinancialsOrThrow(settled, cacheKey)`: if every one of
the 5 results is `rejected`, it throws (propagating through `serverCache`'s loader, so the
all-null bundle is never cached and the key's real failure-tracking fires); otherwise it returns
the bundle with each individually-failed field falling back to `null`/`[]`, identical to today's
existing per-field defaults. The one existing call site
(`dossierFetch(() => fetchFinancialsBundle(sym), {ratios:null,...}, t, signal)`, line ~400)
already catches a rejection and substitutes the same honest fallback for that one read — the only
behavior change is that the NEXT read for the same ticker retries fresh instead of being frozen
for the full hour.

## Blast radius

`fetchFinancialsBundle` has exactly one caller (`dossier.ts`'s own `fetchTickerDossier`) and is
not re-implemented anywhere else in the repo (`grep -rn "fetchFinancialsBundle" src/` confirms).
The broader pattern this fix encodes — a cache-wrapped loader whose body swallows every
sub-fetch's failure before the loader itself can observe any failure — is the same shape as
#7773's Meridian fix, just via `Promise.allSettled` fan-out instead of a single `try/catch`; a
fresh grep for other `Promise.all([...]).catch-per-item...)` loaders feeding `serverCache`/
`TTL.REFERENCE` callers is a reasonable next lead for a future round, not attempted here to keep
this PR single-issue.

## Fix rationale

Chose "throw when ALL fail, keep today's per-field fallback when AT LEAST ONE succeeds" rather
than failing (and not caching) on ANY single failure, because the 5 sources are genuinely
independent and a ticker legitimately missing just one of them (e.g. no analyst coverage, or a
Benzinga-specific blip while Polygon is healthy) is real, cacheable data — not an outage. Only the
all-five-failed case is structurally indistinguishable from "the upstream is down right now,"
which is exactly the case that must not be frozen into the cache.
