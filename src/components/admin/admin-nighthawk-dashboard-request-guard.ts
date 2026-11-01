/**
 * Guards against applying a stale, out-of-order fetch response in the admin
 * Night Hawk analytics dashboard (`AdminNightHawkDashboard.tsx`).
 *
 * `load()` is invoked from THREE independent triggers that can all be
 * in-flight at once: a 30s auto-refresh poll (`load(false)`), the window-
 * range tabs (7d/30d/90d — each click re-runs the effect that calls
 * `load(true)` because `load` is recreated whenever `windowDays` changes),
 * and "Run now" (`runNow()`, which calls `load(false)` after kicking off the
 * edition pipeline). Nothing tracked which of these was issued LAST, so an
 * earlier call for a STALE window (e.g. "7d", already in flight when the
 * admin clicked "30d") can resolve AFTER the newer "30d" call and silently
 * overwrite the screen — `data.window_days` reverts to 7 while the "30d" tab
 * still reads highlighted, and every ring/table on the page quietly shows
 * the wrong window's numbers with no visible error. Same bug shape as
 * `AdminApiEventDetail.tsx` (#6926), `user-management-request-guard.ts`
 * (#6927) and `admin-api-dashboard-request-guard.ts` (#6929+), here keyed by
 * "which load() call fired most recently" instead of a selected id or
 * search term.
 *
 * `runGuardedNighthawkLoad` closes it generically and without any React/DOM
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
export async function runGuardedNighthawkLoad<T>(
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
