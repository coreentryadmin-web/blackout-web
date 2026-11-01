/**
 * Guards `HomeGammaPromo`'s public gamma-snapshot fetch against applying a stale, out-of-order
 * response.
 *
 * `loadTicker(next)` is invoked from TWO independent triggers that can both be in flight at once:
 * a 5s visibility-gated poll (closed over whichever `ticker` was selected when its effect last
 * ran) and a manual ticker-pill click (`selectTicker`, which flips `ticker` state and immediately
 * calls `loadTicker` for the new one). Nothing previously tracked which ticker's request was
 * issued LAST: if a poll tick for the ticker the member just clicked AWAY FROM happens to resolve
 * AFTER the click's own fetch for the NEW ticker, the old code applied it unconditionally —
 * repainting e.g. SPX's spot/call-wall/put-wall/flip numbers under a "QQQ" tab the member had
 * already selected. The visible defect is a levels panel whose active tab and displayed numbers
 * disagree, and a faster background poll makes it MORE likely to happen, not less.
 *
 * The sibling authenticated widget, `GammaSnapshotWidget.tsx` (src/components/tools/), already
 * carries this exact fix via an inline `wantedTicker` ref — its own comment names the same "5s
 * poll racing a ticker click" scenario. This promo panel is the public homepage's near-identical
 * twin of that widget (same `/api/public/gex-snapshot` endpoint, same poll-plus-click shape) and
 * had never received the equivalent guard — a duplicated-logic gap, not a new kind of bug.
 *
 * `runGuardedTickerLoad` closes it generically and without any React/DOM dependency, so it is
 * directly unit-testable: the caller bumps a ref to the ticker it's now requesting (`wanted`)
 * before starting the fetch, and passes `getWantedTicker` to read that ref's CURRENT value at
 * settle time. A response for a ticker that's since been superseded by a newer request is
 * dropped instead of overwriting the newer ticker's already-correct state.
 */
export async function runGuardedTickerLoad<T>(
  wanted: string,
  getWantedTicker: () => string,
  doFetch: () => Promise<T>,
  applyResult: (result: T) => void
): Promise<void> {
  const result = await doFetch();
  if (getWantedTicker() !== wanted) {
    // A newer loadTicker() call has started since this one was issued — its eventual response
    // (or this one, if it resolves last) is what should win, so drop this now-stale result.
    return;
  }
  applyResult(result);
}
