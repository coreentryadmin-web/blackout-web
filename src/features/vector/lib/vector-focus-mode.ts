/**
 * Vector FOCUS MODE — chart-only fullscreen for the /vector desk.
 *
 * Member ask (2026-08-18): "why cant we add full screen to Vector? Like when clicked it only shows
 * the full vector chart? And remove all the other panels."
 *
 * The rule this module encodes is deliberately about MOUNTING, not visibility. Every side rail on
 * the Vector desk owns live work — the matrix rail polls GEX, the Helix rail holds a flow
 * subscription, the action rail re-renders on every ~1Hz spot tick. Hiding them with CSS would keep
 * all of that running underneath a chart that is now the only thing on screen, so focus mode would
 * COST performance at exactly the moment the member wants the chart to be smooth. Unmounting them
 * gives the chart the whole frame budget as well as the whole viewport.
 *
 * The chart itself is the one panel that must NEVER unmount across the toggle — it holds the
 * lightweight-charts instance, the SSE stream, the bead rail state and the member's zoom. The shell
 * keeps it mounted by giving every grid child a stable React key, so removing a sibling can't shift
 * the chart's reconciliation slot.
 */

/** Which desk panels render for a given focus state. `chart` is always true — it is the subject. */
export type VectorPanelVisibility = {
  chart: true;
  ladder: boolean;
  terminal: boolean;
  action: boolean;
  scanner: boolean;
};

/**
 * Panels to MOUNT. In focus mode only the chart survives; everything else is torn down so its
 * polling/subscriptions stop rather than running invisibly behind the fullscreen surface.
 */
export function vectorPanelVisibility(focusMode: boolean): VectorPanelVisibility {
  return {
    chart: true,
    ladder: !focusMode,
    terminal: !focusMode,
    action: !focusMode,
    scanner: !focusMode,
  };
}

/**
 * Escape leaves focus mode — the conventional exit for any fullscreen surface, and the only one a
 * member has if the toolbar scrolls out of reach. Matched on `key` (not the deprecated `keyCode`)
 * and only when no modifier is held, so it can't steal a browser/OS shortcut.
 */
export function shouldExitFocusMode(e: {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): boolean {
  if (e.key !== "Escape") return false;
  return !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
}

/**
 * Focus mode is a DESKTOP affordance. On the iOS native shell the desk is already one panel at a
 * time (VECTOR_IOS_PANELS) — a second, overlapping fullscreen concept there would fight the segment
 * switcher and leave the member with two different ways out of the same state. The chart-only embed
 * (SPX Slayer) is likewise already chart-only and supplies its own page chrome.
 */
export function focusModeAvailable(opts: { chartOnly: boolean; nativeShell: boolean }): boolean {
  return !opts.chartOnly && !opts.nativeShell;
}

/**
 * Classes for PageShell's CONTENT wrapper while focus mode is on.
 *
 * WHY THIS EXISTS — the second half of a bug that a z-index bump alone could not fix.
 *
 * The fullscreen surface (`.vector-page-inner-focus`) is `position: fixed; z-index: 110`, chosen to
 * outrank `.nav-bar` at z-100. Measured on prod after that shipped, the nav STILL painted over the
 * chart toolbar, and `document.elementFromPoint` at the toolbar's own centre returned
 * `header.nav-bar` — every control present, none of them clickable.
 *
 * The reason is that a z-index is only compared against SIBLINGS inside its own stacking context.
 * PageShell renders its content wrapper as `relative z-10`, which creates a stacking context, so
 * the fullscreen surface's 110 competed only with other children of that wrapper. As a whole, the
 * wrapper sat at 10 against the nav's 100 at the root — the fullscreen layer was always going to
 * lose, at 60, at 110, or at any other number.
 *
 * So the wrapper itself has to be lifted, and only while focus mode is on: outside focus mode the
 * page content must stay UNDER the nav or it would cover the site header on the ordinary desk.
 *
 * The rule is written in globals.css as `.vector-page-content.vector-page-content-focus` — TWO
 * classes deliberately. The value it has to beat, `z-10`, is a Tailwind utility, and the utilities
 * layer is emitted AFTER the components layer, so a single-class rule of equal specificity would
 * lose the cascade and silently do nothing. Two classes outrank one whatever the layer order.
 * (An `!z-[110]` utility in this file would also work, but only for as long as tailwind.config's
 * content globs keep matching `.ts` — a dependency nothing here would notice breaking.)
 *
 * The z-index itself lives in the stylesheet next to `.vector-page-inner-focus`, so the two halves
 * of one layering decision cannot drift apart.
 */
export const VECTOR_PAGE_CONTENT_FOCUS_CLASS = "vector-page-content-focus";

export function focusModeContentClass(focusMode: boolean): string | null {
  return focusMode ? VECTOR_PAGE_CONTENT_FOCUS_CLASS : null;
}
