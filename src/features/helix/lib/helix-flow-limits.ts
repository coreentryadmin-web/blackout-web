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
