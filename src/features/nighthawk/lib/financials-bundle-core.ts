/**
 * Pure helper for `dossier.ts`'s `fetchFinancialsBundle` — kept in a sibling module with no
 * `server-only` import (directly OR transitively) so it is unit-testable; `dossier.ts` itself
 * cannot be (it imports `./ticker-greek-flow-summary`, which imports `server-only`).
 *
 * THE BUG (found 2026-11-09, round 495, following up on round 494's #7773 lead). Before this
 * fix, `fetchFinancialsBundle` ran its five upstream calls (Polygon ratios/income/balance/
 * cash-flow + Benzinga price target) each with its OWN `.catch(() => null | [])`, inside a
 * `Promise.all` that was itself the loader passed to `serverCache(..., TTL.REFERENCE, ...)`
 * (a 1-HOUR TTL). Because every individual failure was swallowed before it ever reached the
 * `Promise.all`, that `Promise.all` — and therefore the `serverCache` loader — could never
 * reject, no matter how many of the five calls actually failed. A full Polygon/Benzinga outage
 * (same shape as the entitlement-loss incidents already logged in this repo's CLAUDE.md) or
 * even a correlated rate-limit/timeout hitting all five at once therefore produced a
 * completely legitimate-LOOKING `{ratios:null, signals:null, priceTarget:null}` bundle, which
 * `serverCache`'s success path (`server-cache.ts`'s `refreshCache`, the `.then()` branch) wrote
 * into the cache for the full hour and used to RESET the key's failure tracking
 * (`failureCount`/`degradedKeys`) — exactly the "absence-as-fact" trap this codebase's audit
 * notes call out repeatedly elsewhere (Benzinga entitlement loss, empty earnings cohorts,
 * #7773's Meridian peer-reaction cache), just reached via five parallel `.catch()`s instead of
 * one `try/catch` wrapping a single fetch.
 *
 * Consequence: a ticker that hit this during a transient blip read as "no fundamentals data"
 * (financial ratios, revenue/margin trend, analyst PT — none of it) to every Night Hawk dossier
 * consumer for up to an hour, with no retry possible in that window, even though the real
 * upstream might have recovered in seconds. `serverCache`'s own SWR/degraded-key machinery
 * exists specifically to retry past exactly this kind of transient failure — it never got the
 * chance, because the loader never told it anything failed.
 *
 * THE FIX. `settledFinancialsOrThrow` takes the `Promise.allSettled` results of the five calls
 * (computed with NO per-call `.catch()` — `dossier.ts` now passes bare promises). If every one
 * of them rejected, it throws, so the rejection propagates THROUGH `serverCache`'s loader: the
 * key is never written to cache (`refreshCache`'s success branch, which calls `setStoreEntry`,
 * runs only when the loader's promise fulfills) and the key's real failure-tracking fires
 * instead. The outer `dossierFetch(...)` call at the one existing `fetchFinancialsBundle(sym)`
 * call site already catches that rejection and substitutes today's same honest
 * `{ratios:null, signals:null, priceTarget:null}` fallback for THAT ONE read — the difference
 * is the NEXT read for the same ticker retries fresh instead of being frozen for an hour.
 *
 * If at least one of the five succeeded, this is a genuine (if partial) result — e.g. a ticker
 * that legitimately has no analyst price target, or a Benzinga-specific outage while Polygon is
 * healthy — and is cached exactly as before, with each failed field independently falling back
 * to `null`/`[]`, unchanged from the pre-fix per-field defaults.
 */
export function settledFinancialsOrThrow<A, B, C, D, E>(
  settled: [
    PromiseSettledResult<A>,
    PromiseSettledResult<B>,
    PromiseSettledResult<C>,
    PromiseSettledResult<D>,
    PromiseSettledResult<E>,
  ],
  cacheKey: string
): { ratios: A | null; income: B | []; balance: C | []; cashFlow: D | []; priceTarget: E | null } {
  if (settled.every((s) => s.status === "rejected")) {
    const reasons = settled.map((s) => String((s as PromiseRejectedResult).reason));
    throw new Error(
      `fetchFinancialsBundle(${cacheKey}): all 5 upstream calls failed — not caching an all-null bundle. ` +
        `Reasons: ${reasons.join(" | ")}`
    );
  }
  const [ratiosR, incomeR, balanceR, cashFlowR, priceTargetR] = settled;
  return {
    ratios: ratiosR.status === "fulfilled" ? ratiosR.value : null,
    income: incomeR.status === "fulfilled" ? incomeR.value : ([] as unknown as B | []),
    balance: balanceR.status === "fulfilled" ? balanceR.value : ([] as unknown as C | []),
    cashFlow: cashFlowR.status === "fulfilled" ? cashFlowR.value : ([] as unknown as D | []),
    priceTarget: priceTargetR.status === "fulfilled" ? priceTargetR.value : null,
  };
}
