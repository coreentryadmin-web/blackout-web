/**
 * Does a URL change from a click need a browser-history BACK to recover from?
 *
 * `live-ui-interaction-audit.mjs` calls `page.goBack()` whenever a click changes the URL, so a
 * later control isn't accidentally measured on the wrong page. That assumption breaks for a
 * REPLACE-based URL change (a tab/view toggle implemented with `router.replace()`, e.g. Night
 * Hawk's view switcher or Meridian's view/filter params): the URL changes but no history entry is
 * pushed, so `goBack()` has nothing of the app's own to return to — it pops into whatever history
 * this Playwright context held before the run's own `page.goto()`, which in a fresh audit context
 * is the browser's own blank initial page, not anything Night Hawk rendered.
 *
 * Measured live 2026-08-24: clicking Night Hawk's "0DTE" tab changed the URL
 * (`/nighthawk` -> `/nighthawk?view=zero_dte`) but `history.length` was IDENTICAL before and after
 * — confirming `NightHawkFeed.tsx`'s `router.replace(...)` never pushes. The subsequent
 * `page.goBack()` landed on `about:blank`, and the harness reported "BACK from 0DTE left the page
 * unusable (chars:0)" — a real, reproducible false positive that would have fired on every future
 * run, not a Night Hawk defect: nothing left `path` in the first place, so there is nothing to
 * recover FROM.
 *
 * @param {{url: string, historyLength: number}} before fingerprint taken before the click
 * @param {{url: string, historyLength: number}} after fingerprint taken after the click settled
 * @returns {boolean} true only when the URL changed AND a new history entry was actually pushed
 */
export function needsBackRecovery(before, after) {
  if (!before || !after) return false;
  return before.url !== after.url && after.historyLength > before.historyLength;
}
