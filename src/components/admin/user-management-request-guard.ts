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

/**
 * Guards the admin User Management DETAIL PANEL against the same class of race, keyed by
 * which user id is "current" rather than a bare counter.
 *
 * `openUserDetail(userId)` used to be a bare `fetch(...).then(setSelectedUser)` with no guard
 * at all — clicking row A then row B before A's (slower) response arrived started a second,
 * independent fetch, and if A's response resolved AFTER B's, `setSelectedUser(A)` fired last
 * and silently swapped the open panel from B back to A while it was still titled/keyed for B.
 * Same shape as `loadEventDetailIfCurrent` in `AdminApiEventDetail.tsx` (#6926), keyed by user
 * id instead of event id.
 *
 * `syncWhop`'s own post-sync detail refresh races the SAME `openUserDetail` calls: it starts a
 * fetch for whichever user was selected when Sync was clicked, and if the admin opens a
 * DIFFERENT user's panel while that refresh is still in flight, the refresh's eventual
 * `setSelectedUser` must not overwrite the newly-opened panel either. Sharing this one guard
 * (keyed by the same "current user id" ref) across both call sites closes the race for each
 * independently and for the two together.
 *
 * `getCurrentUserId` returning `null` (panel closed in the meantime) also drops the response —
 * reopening a panel the admin already dismissed would be the same stale-overwrite bug in a
 * different guise.
 */
export async function applyUserDetailIfCurrent<T>(
  userId: string,
  fetchFn: (id: string) => Promise<T | null>,
  getCurrentUserId: () => string | null,
  apply: (detail: T) => void
): Promise<void> {
  const data = await fetchFn(userId);
  if (data == null) return;
  if (getCurrentUserId() !== userId) {
    // Superseded by a different user's panel (or the panel was closed) since this fetch
    // started — drop it rather than reopening/overwriting with the wrong user's data.
    return;
  }
  apply(data);
}
