/** HELIX tape paging — shared between API route and client. */

/** Default rows per page (initial load + each "Load older" click). */
export const HELIX_FLOW_PAGE_SIZE = 500;

/** Hard max rows per API request (Postgres LIMIT). */
export const HELIX_FLOW_MAX_LIMIT = 5000;

/** Default lookback window for the tape (7 days). */
export const HELIX_FLOW_DEFAULT_SINCE_HOURS = 168;

/** Max lookback the API accepts (30 days). */
export const HELIX_FLOW_MAX_SINCE_HOURS = 720;

/** Estimated row height (px) for tape virtualization. */
export const HELIX_TAPE_ROW_HEIGHT = 42;

/** Virtualizer overscan (rows above/below viewport). */
export const HELIX_TAPE_OVERSCAN = 8;

/** Premium below which the member's /flows panels hide a print (FlowFeed.tsx FLOOR_PREMIUM).
 *  Exported so Largo can DISCLOSE the member-panel floor without adopting it — the tool serves
 *  a model, which is better off seeing the small prints, but a member comparing the two
 *  surfaces deserves an explanation for the difference rather than a silent mismatch. */
export const HELIX_MEMBER_PANEL_PREMIUM_FLOOR = 200_000;

/** Premium at or above which a print is called a whale, across every HELIX tape surface.
 *  Lives here because this module is already the shared tape-limits home imported by the API
 *  route, the client desk and the Largo reads — so the threshold has ONE definition rather than
 *  a literal repeated per surface. */
export const WHALE_PRINT_PREMIUM = 1_000_000;

/**
 * The premium floor a member starts on, and the value the filter chrome compares against to decide
 * whether a filter is "active".
 *
 * It was `useState(200_000)` in `FlowFeed` and a bare `!== 200_000` in `HelixCommandBar`'s
 * `activeFilterCount`, a hundred lines apart in different files. They agree today. If the default
 * ever moves and the comparison does not, the chip counter reports **one active filter on a fresh,
 * untouched page** — a count that lies about whether the member has filtered anything at all.
 */
export const HELIX_DEFAULT_MIN_PREMIUM = HELIX_MEMBER_PANEL_PREMIUM_FLOOR;

/**
 * The premium presets offered in the filter UI.
 *
 * Was declared VERBATIM in both `FlowFeed.tsx` and `HelixCommandBar.tsx` — the component that
 * renders the chips and the component that owns the state behind them. Two copies of one list, in
 * the two places that must agree about it.
 */
export const HELIX_PREMIUM_PRESETS = [200_000, 500_000, 1_000_000, 20_000_000] as const;
