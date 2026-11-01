/**
 * Guards the X-Intel queue detail page's row fetch against an out-of-order resolution.
 *
 * `XIntelDetailPage` keys its fetch effect on the route's `[id]` param (`useEffect(..., [id])`),
 * but the App Router does NOT remount the page component when navigating between two sibling
 * detail routes (`/admin/x-intel/123` -> `/admin/x-intel/456`) — it's the same mounted component,
 * so the effect simply re-runs. If an admin opens row 123, then clicks a different row (456)
 * before 123's fetch resolves, TWO requests are in flight. Without a guard, whichever response
 * lands LAST wins via a bare `.then(setRow)` — if 123's (slower) response happens to resolve
 * after 456's, the page ends up titled/keyed for 456 but showing 123's headline, post copy and
 * "record tweet ID" form, and a `submit` there would attach the wrong tweet ID to the wrong
 * queue cycle. This mirrors the exact bug class `AdminApiEventDetail`'s `loadEventDetailIfCurrent`
 * fixes for the admin API event drawer (round 121) — same shape, different surface.
 *
 * `loadXIntelRowIfCurrent` only applies a response (success OR error) when the id it was
 * fetched for is STILL the latest id the page has been asked to show; a superseded response is
 * silently dropped rather than clobbering the newer one.
 */
export async function loadXIntelRowIfCurrent<T>(
  requestedId: string,
  fetchFn: () => Promise<T>,
  getLatestId: () => string | null,
  onSuccess: (data: T) => void,
  onError: (message: string) => void,
  onSettled: () => void
): Promise<void> {
  try {
    const data = await fetchFn();
    if (getLatestId() === requestedId) onSuccess(data);
  } catch (err) {
    if (getLatestId() === requestedId) {
      onError(err instanceof Error ? err.message : "Failed to load row");
    }
  } finally {
    if (getLatestId() === requestedId) onSettled();
  }
}
