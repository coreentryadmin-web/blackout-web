/** SERP-independent length bound for `/api/og`'s title — see route.tsx for why. */
export const OG_MAX_TITLE_LENGTH = 100;

/**
 * Bounds a title before it reaches the /api/og image renderer. `/api/og` is a public,
 * directly-fetchable endpoint with no other server-side validation, so this must not assume
 * callers behave (every current caller keeps titles short, but the route itself can't trust
 * that for a query param anyone can hit directly).
 */
export function truncateOgTitle(title: string): string {
  return title.length > OG_MAX_TITLE_LENGTH
    ? `${title.slice(0, OG_MAX_TITLE_LENGTH - 3)}...`
    : title;
}
