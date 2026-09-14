/**
 * Wrap a fetch-like factory function with a timeout, racing it against a deadline that
 * returns `fallback` when it fires.
 *
 * `fn` RECEIVES an AbortSignal, and the signal IS aborted when the deadline fires — but
 * whether that actually stops the underlying HTTP connection depends entirely on `fn`
 * passing it down to `fetch()` (or another AbortSignal-aware API). **As of 2026-09-14, no
 * caller in this codebase does**: every `dossierFetch(...)` call site in `dossier.ts` (14
 * direct calls + 10 more inside its `runUwPooled` second wave) passes a bare `() => someFetch(...)`
 * that ignores the `signal` argument entirely, and none of the ~20 wrapped provider functions
 * (`fetchMarketFlowAlertRows`, `fetchPositioningSummary`, `buildTechnicalCard`,
 * `fetchPolygonNews`, `fetchBenzingaCatalysts`, the `fetchUw*` family, etc.) accept an
 * AbortSignal parameter at all — confirmed by grepping every call site and a sample of the
 * wrapped functions' own signatures. So today this function's real behavior is "stop WAITING
 * on `fn` and use `fallback`", not "stop the underlying request" — the abandoned request keeps
 * running to completion in the background, still holding a connection and consuming upstream
 * quota/CPU, exactly the dangling-connection cost this function's name and original doc
 * promised to prevent. See `docs/audit/findings-staging/2026-09-14-dossier-fetch-timeout-no-abort-wiring.md`
 * for the full write-up (held, not fixed — threading real cancellation through ~20 provider
 * functions across multiple files is an architectural change, not a local one). Wiring a real
 * caller's `fn` to actually use `signal` restores the original intended behavior for that one
 * call site; until then, don't assume timing out here frees the underlying resource.
 */
export function dossierFetch<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  fallback: T,
  ms = 8000
): Promise<T> {
  const controller = new AbortController();
  let timerId: ReturnType<typeof setTimeout>;

  const timeout = new Promise<T>((resolve) => {
    timerId = setTimeout(() => {
      controller.abort();
      resolve(fallback);
    }, ms);
  });

  const work = fn(controller.signal).catch(() => fallback);

  return Promise.race([
    work.finally(() => clearTimeout(timerId)),
    timeout,
  ]);
}
