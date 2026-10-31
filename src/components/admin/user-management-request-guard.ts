/**
 * Guards against applying a stale, out-of-order fetch response in the admin
 * User Management table.
 *
 * `UserManagement.tsx`'s `fetchUsers` re-runs on EVERY change to the search
 * box (no debounce) — typing "AAP" then "AAPL" fires two overlapping
 * `GET /api/admin/users?q=...` requests with nothing stopping the EARLIER,
 * slower one ("AAP") from resolving AFTER the LATER, faster one ("AAPL") and
 * overwriting the admin's screen with results for a query they've already
 * typed past. This is the same shape of bug fixed in `AdminApiEventDetail.tsx`
 * (#6926) for the API-forensics drawer's per-event detail fetch, just keyed
 * by a free-text search term instead of a selected event id.
 *
 * `runGuardedUsersFetch` closes it generically and without any React/DOM
 * dependency, so it's directly unit-testable: the caller bumps a counter
 * (e.g. a ref) each time it starts a new fetch and passes that bumped value
 * as `requestId`; `getLatestRequestId` reads the CURRENT value of that same
 * counter. Once `doFetch` resolves, the result is only handed to
 * `applyResult` if `requestId` is still the most recently issued request —
 * i.e. no newer request has started in the meantime. A response for a
 * request that's since been superseded is silently dropped instead of
 * clobbering newer state with stale data.
 */
export async function runGuardedUsersFetch<T>(
  requestId: number,
  getLatestRequestId: () => number,
  doFetch: () => Promise<T>,
  applyResult: (result: T) => void
): Promise<void> {
  const result = await doFetch();
  if (getLatestRequestId() !== requestId) {
    // A newer request has started since this one was issued — its eventual
    // response (or this one, if it resolves last) is what should win, so
    // drop this now-stale result on the floor.
    return;
  }
  applyResult(result);
}
