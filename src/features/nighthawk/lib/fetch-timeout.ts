/**
 * Wrap a fetch-like factory function with a timeout, racing it against a deadline that
 * returns `fallback` when it fires.
 *
 * `fn` RECEIVES an AbortSignal, and the signal IS aborted when the deadline fires OR when
 * `outerSignal` fires (e.g. dossier.ts's per-ticker 45s wall) — combined via `AbortSignal.any`
 * so either trigger cancels the same underlying work.
 *
 * FIXED 2026-09-17 (was HELD as `dossierFetch's abort contract is unwired everywhere it's
 * used` in FINDINGS.md, 2026-09-14): every `dossierFetch(...)` call site in `dossier.ts`
 * used to pass a bare `() => someFetch(...)` that discarded the `signal` argument entirely,
 * and none of the wrapped provider functions accepted one — so timing out here only ever
 * meant "stop WAITING on `fn`", not "stop the underlying request": the abandoned fetch kept
 * running to completion in the background, still holding a connection and still consuming
 * the shared UW rate-limiter's scarce admission slot after this ticker had already been
 * given up on. Every dossier.ts call site now threads its own `fn`'s real `signal` down to
 * the wrapped provider (fetchUwDarkPool, uwGetSafe, trackedFetch, ...), which DOES pass it
 * to the real `fetch()` call — so aborting here now genuinely terminates the connection.
 */
export function dossierFetch<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  fallback: T,
  ms = 8000,
  outerSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  let timerId: ReturnType<typeof setTimeout>;

  if (outerSignal?.aborted) {
    controller.abort(outerSignal.reason);
    return Promise.resolve(fallback);
  }
  const onOuterAbort = () => controller.abort(outerSignal!.reason);
  outerSignal?.addEventListener("abort", onOuterAbort, { once: true });

  const timeout = new Promise<T>((resolve) => {
    timerId = setTimeout(() => {
      controller.abort(new DOMException(`dossierFetch ${ms}ms local timeout`, "AbortError"));
      resolve(fallback);
    }, ms);
  });

  const work = fn(controller.signal).catch(() => fallback);

  return Promise.race([
    work.finally(() => {
      clearTimeout(timerId);
      outerSignal?.removeEventListener("abort", onOuterAbort);
    }),
    timeout,
  ]);
}
