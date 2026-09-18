/**
 * Reference-counted cancellation for a coalesced (shared, in-flight) async request.
 *
 * WHY THIS EXISTS: `uwCacheGet` (uw-shared-cache.ts) and `throttleUwCoalesced`
 * (uw-rate-limiter.ts) both let MULTIPLE concurrent callers share ONE in-flight
 * request for the same key (e.g. two different Night Hawk Legacy candidates, or
 * Legacy and a completely different product, both wanting the same ticker's dark-pool
 * data at once). Phase 2 threads a per-caller AbortSignal through this stack so a
 * timed-out ticker can cancel its own outstanding UW requests — but a coalesced
 * request is, by definition, not "owned" by any one caller. If caller A's wall-clock
 * timeout naively called `controller.abort()` on the shared request, caller B (still
 * legitimately waiting on the exact same promise) would have its data pulled out from
 * under it for a reason that has nothing to do with B's own ticker.
 *
 * The fix: the underlying request is only actually aborted when the LAST attached
 * caller detaches without the request having already settled. Every caller gets an
 * idempotent `detach()` — calling it more than once (e.g. once from an abort-listener
 * and once from the caller's own `finally` block) only decrements the waiter count
 * once, so double-detach can never produce a negative count or a premature abort.
 */

export type CoalescedRequestGroup<T> = {
  /** The shared underlying promise every attached caller awaits. */
  promise: Promise<T>;
  /**
   * Register one caller against this group. If `signal` is already aborted, the
   * caller is immediately detached (decrementing back to where it started) and the
   * underlying request is aborted if no other callers remain — covers "caller arrives
   * with an already-aborted signal" without ever incrementing past zero net waiters.
   * Returns an idempotent detach function: exactly one decrement happens no matter
   * how many times (or from how many trigger paths) it is called.
   */
  attach(signal?: AbortSignal): () => void;
};

/**
 * `run` receives the group's OWN internal AbortSignal — aborted only once every
 * attached caller has detached (and the request hasn't already settled on its own).
 */
export function createCoalescedRequestGroup<T>(
  run: (signal: AbortSignal) => Promise<T>
): CoalescedRequestGroup<T> {
  const controller = new AbortController();
  let waiters = 0;
  let settled = false;

  const promise = run(controller.signal).finally(() => {
    settled = true;
  });

  function attach(signal?: AbortSignal): () => void {
    waiters += 1;
    let detached = false;

    const detach = () => {
      if (detached) return; // idempotent — a second call is a no-op, never double-decrements
      detached = true;
      signal?.removeEventListener("abort", onAbort);
      waiters -= 1;
      if (waiters <= 0 && !settled) {
        controller.abort(signal?.reason ?? new DOMException("Aborted — no active callers remain", "AbortError"));
      }
    };

    function onAbort() {
      detach();
    }

    if (signal) {
      if (signal.aborted) {
        // Already-aborted caller: attach then immediately detach, net effect zero —
        // never leaves a phantom waiter that would block a real cancellation later.
        detach();
        return detach;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    return detach;
  }

  return { promise, attach };
}
