/**
 * A signed-in member actively on one of the desk pages (Night Hawk, Vector, Helix, etc.) has no
 * use for marketing-funnel links (FAQ/Pricing/Learn) — those exist to convert a visitor deciding
 * whether to sign up, not to serve a paying member already using the product. Left unconditional,
 * every desk's shared header wasted space on, and read as unfinished next to, links a member
 * sitting on their live desk would never click.
 *
 * Deliberately does NOT gate the Features dropdown — on a desk page that's the real cross-product
 * switcher (see Nav.tsx's FeatureCards "● LIVE" badge on the active product), not a marketing surface.
 */
export function isSignedInOnDeskPage(
  isSignedIn: boolean,
  path: string,
  deskHrefPrefixes: readonly string[]
): boolean {
  return isSignedIn && deskHrefPrefixes.some((href) => path.startsWith(href));
}
