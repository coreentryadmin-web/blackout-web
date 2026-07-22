/**
 * Wrap a fetch-like factory function with a timeout that actually aborts the
 * underlying HTTP connection via AbortController.
 *
 * `fn` receives an AbortSignal it must pass to fetch() (or any other
 * AbortSignal-aware API).  When the deadline fires the signal is aborted and
 * `fallback` is returned — no dangling connection left open.
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
