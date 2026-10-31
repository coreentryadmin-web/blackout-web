/**
 * Guards against applying a stale, out-of-order fetch response in the admin
 * X Intel Queue panel (`AdminXIntelQueuePanel.tsx`).
 *
 * `load()` is invoked from TWO independent triggers that can both be
 * in-flight at once: a 120s background poll (`setInterval`) and the status
 * filter dropdown — switching "ALL" -> "SKIP" recreates `load()` (it closes
 * over `status`) and the effect that owns the poll interval re-fires it
 * immediately for the new status. Nothing previously stopped an EARLIER
 * request (e.g. a poll tick for "ALL" that was already in flight when the
 * admin switched the filter to "SKIP") from resolving AFTER the LATER,
 * filter-driven request and overwriting the screen: the dropdown would show
 * "Skip" selected while the table silently repainted with the unfiltered
 * "ALL" rows (or vice versa) the moment the slower response landed. Same bug
 * shape as `admin-api-dashboard-request-guard.ts` (#6926) and
 * `user-management-request-guard.ts` (#6927), here keyed by "which load()
 * call fired most recently" rather than a selected id or free-text term.
 *
 * `runGuardedXIntelQueueLoad` closes it generically and without any
 * React/DOM dependency, so it's directly unit-testable: the caller bumps a
 * counter (e.g. a ref) each time it starts a new `load()` call and passes
 * that bumped value as `requestId`; `getLatestRequestId` reads the CURRENT
 * value of that same counter. Once `doFetch` resolves, the result is only
 * handed to `applyResult` if `requestId` is still the most recently issued
 * request — i.e. no newer `load()` call has started in the meantime. A
 * response for a call that's since been superseded is dropped instead of
 * clobbering fresher state (including state a newer call hasn't even
 * resolved yet — this guard only ever drops the SUPERSEDED side, never
 * blocks the newer one).
 */
export async function runGuardedXIntelQueueLoad<T>(
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
