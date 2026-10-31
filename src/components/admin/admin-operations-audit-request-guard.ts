/**
 * Guards against applying a stale, out-of-order fetch response to the Audit
 * Trail panel in the admin Operations Center (`AdminOperationsDashboard.tsx`).
 *
 * `loadAudit()` is invoked from TWO independent triggers that can both be
 * in-flight at once: a 30s poll (`AUDIT_MS`) and every keystroke in either
 * free-text filter box (`FilterSearch` "Action"/"Actor" — no debounce,
 * `onChange` fires `setAuditAction`/`setAuditActor` directly, which are both
 * deps of the `loadAudit` callback). Typing "AAP" then "AAPL" fires two
 * overlapping `GET /api/admin/audit-log?action=...` requests, and nothing
 * previously stopped the EARLIER, slower one ("AAP") from resolving AFTER the
 * LATER, faster one ("AAPL") and overwriting the admin's screen with audit
 * rows for a filter they've already typed past — or a background 30s poll's
 * response landing after a filter change and silently reverting it back to
 * the unfiltered/previous-filter view. Same bug shape as
 * `user-management-request-guard.ts` (#6927, keyed by search term) and
 * `admin-api-dashboard-request-guard.ts` (#6971-era, keyed by "which load()
 * call fired most recently") — this is the Operations Center's own
 * previously-unfixed instance of the identical race.
 *
 * `runGuardedAuditLoad` closes it generically and without any React/DOM
 * dependency, so it's directly unit-testable: the caller bumps a counter
 * (e.g. a ref) each time it starts a new `loadAudit()` call and passes that
 * bumped value as `requestId`; `getLatestRequestId` reads the CURRENT value
 * of that same counter. Once `doFetch` resolves, the result is only handed
 * to `applyResult` if `requestId` is still the most recently issued request —
 * i.e. no newer `loadAudit()` call has started in the meantime. A response
 * for a call that's since been superseded is dropped instead of clobbering
 * fresher state.
 */
export async function runGuardedAuditLoad<T>(
  requestId: number,
  getLatestRequestId: () => number,
  doFetch: () => Promise<T>,
  applyResult: (result: T) => void
): Promise<void> {
  const result = await doFetch();
  if (getLatestRequestId() !== requestId) {
    // A newer loadAudit() call has started since this one was issued — its
    // eventual response (or this one, if it resolves last) is what should
    // win, so drop this now-stale result on the floor.
    return;
  }
  applyResult(result);
}
