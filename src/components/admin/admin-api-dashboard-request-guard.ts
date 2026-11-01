/**
 * Guards against applying a stale, out-of-order fetch response in the admin
 * API Command Center dashboard (`AdminApiDashboard.tsx`).
 *
 * `load()` is invoked from THREE independent triggers that can all be
 * in-flight at once: an 8s telemetry poll (`load(false)`), a 120s probe poll
 * (`load(true)`), and two manual actions — the "Probe providers" button
 * (`load(true)`) and "Rescan codebase" (`rescan()`, which POSTs then calls
 * `load(false)`). Nothing tracked which of these was issued LAST, so an
 * earlier call that happens to resolve slower (e.g. the periodic poll that
 * was already in flight when the admin clicked Rescan) can land AFTER a
 * later, faster one and silently overwrite the screen with stale data —
 * visibly reverting the very dashboard refresh the admin just triggered by
 * clicking Rescan/Probe. Same bug shape as `AdminApiEventDetail.tsx` (#6926)
 * and `user-management-request-guard.ts` (#6927), here keyed by "which load()
 * call fired most recently" instead of a selected id or search term.
 *
 * `runGuardedDashboardLoad` closes it generically and without any React/DOM
 * dependency, so it's directly unit-testable: the caller bumps a counter
 * (e.g. a ref) each time it starts a new `load()` call and passes that
 * bumped value as `requestId`; `getLatestRequestId` reads the CURRENT value
 * of that same counter. Once `doFetch` resolves, the result is only handed
 * to `applyResult` if `requestId` is still the most recently issued request —
 * i.e. no newer `load()` call has started in the meantime. A response for a
 * call that's since been superseded is dropped instead of clobbering fresher
 * state (including state a newer call hasn't even resolved yet — this guard
 * only ever drops the SUPERSEDED side, never blocks the newer one).
 */
export async function runGuardedDashboardLoad<T>(
  requestId: number,
  getLatestRequestId: () => number,
  doFetch: () => Promise<T>,
  applyResult: (result: T) => void
): Promise<void> {
  const result = await doFetch();
  if (getLatestRequestId() !== requestId) {
    // A newer load() call has started since this one was issued — its
    // eventual response (or this one, if it resolves last) is what should
    // win, so drop this now-stale result on the floor.
    return;
  }
  applyResult(result);
}
