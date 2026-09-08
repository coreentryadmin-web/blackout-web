/**
 * Meridian desk URL state — pure parse/serialize for the deep-linkable parts of the desk.
 *
 * Before this, selecting an event changed nothing in the address bar: the view could not be
 * linked to a colleague, could not be bookmarked, and a reload silently dropped the reader back
 * onto whatever event happened to be first. Measured live 2026-08-18 on desktop and phone.
 *
 * Only state a reader would expect a link to carry lives here. Transient UI (an open drawer, a
 * hovered level, which dimension is expanded) deliberately does NOT — a URL that changes on
 * hover is noise, and restoring a half-open drawer from a link is worse than not restoring it.
 */

export type DeskUrlState = {
  /** Selected timeline event id, e.g. `earnings:NVDA:2026-08-20`. */
  event: string | null;
  /** Which top-level desk view is showing. */
  view: "timeline" | "analytics" | null;
  /** Active timeline filter. Free-form because FilterKind spans event kinds plus pseudo-kinds. */
  filter: string | null;
  /**
   * READ-ONLY bootstrap symbol from an incoming link, e.g. `?ticker=TSLA` from another desk's
   * cross-link. One-shot on purpose: it seeds the desk's own search box the same way a member
   * typing the symbol would, so it gets the exact same behavior (auto-selects if the name's next
   * print is in the visible 21-day timeline window, otherwise surfaces the "Earnings lookup" card
   * for names further out) — no second search path to keep in sync with the real one. Never
   * round-trips back into the URL: `deskUrlSearch` does not emit it, so once the desk settles on
   * an `event` selection the address bar reads as a normal Meridian link, not a lingering
   * `?ticker=` from wherever the reader arrived.
   */
  ticker: string | null;
};

const VIEWS = new Set(["timeline", "analytics"]);

/**
 * Read desk state out of a query string.
 *
 * Unknown values are dropped rather than passed through: a `view=hacked` in a pasted link must
 * not put the desk into a state the component has no branch for. Anything invalid simply falls
 * back to the component's own default, which is the same thing a link without the param does.
 */
export function parseDeskUrlState(search: string): DeskUrlState {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  } catch {
    return { event: null, view: null, filter: null, ticker: null };
  }
  const view = params.get("view");
  const event = params.get("event");
  const filter = params.get("filter");
  const ticker = params.get("ticker");
  return {
    // An empty param (`?event=`) is the same as absent — it carries no selection.
    event: event && event.trim() ? event : null,
    view: view && VIEWS.has(view) ? (view as DeskUrlState["view"]) : null,
    filter: filter && filter.trim() ? filter : null,
    ticker: ticker && ticker.trim() ? ticker.trim() : null,
  };
}

/**
 * Serialize desk state back to a query string (leading `?`, or "" when nothing is set).
 *
 * Defaults are OMITTED, not written: a desk sitting on its default view should produce a bare
 * `/meridian`, so the common case still yields a clean, shareable URL and the history entry for
 * "I changed nothing" is not distinguishable from the entry for the landing page.
 */
export function deskUrlSearch(state: DeskUrlState): string {
  const params = new URLSearchParams();
  if (state.event) params.set("event", state.event);
  if (state.view && state.view !== "timeline") params.set("view", state.view);
  if (state.filter && state.filter !== "all") params.set("filter", state.filter);
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** True when two states would produce the same URL — used to avoid pushing duplicate history. */
export function sameDeskUrlState(a: DeskUrlState, b: DeskUrlState): boolean {
  return deskUrlSearch(a) === deskUrlSearch(b);
}
