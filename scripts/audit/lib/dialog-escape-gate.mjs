/**
 * Should the "a dialog opened — can Escape close it?" check run for this click?
 *
 * Extracted from `live-ui-interaction-audit.mjs` so the predicate is testable without driving a
 * browser. The audit itself needs a live page; this rule does not, and it is the part that was
 * wrong.
 *
 * THE BUG IT ENCODES. `dialogs` counts `[role=dialog],[aria-modal=true]` in the CURRENT document.
 * Compared across a NAVIGATION it is comparing two different pages, so any dialog-shaped furniture
 * on the destination reads as "a dialog opened" — and Escape then cannot close it, because nothing
 * opened. Measured on production 2026-08-23: `/dashboard`'s four nav links each produced this
 * FAIL, and `/`, `/faq`, `/pricing`, `/learn` each ship exactly 2 such elements in their served
 * HTML. Four failures, one per nav link, none real.
 *
 * A check that fires on healthy pages teaches its reader to skip the report, which is worse than
 * no check — the same principle `ui-geometry-probe.mjs` is built around.
 */

/**
 * @param before {{url: string, dialogs: number}} fingerprint taken before the click
 * @param after  {{url: string, dialogs: number}} fingerprint taken after it
 */
export function shouldCheckEscape(before, after) {
  if (!before || !after) return false;
  // A navigation is audited on its own next pass, where `before` is that page's own baseline.
  if (after.url !== before.url) return false;
  return after.dialogs > before.dialogs;
}
