/**
 * Shared browser-side Clerk cookie reader.
 *
 * Clerk's backend SDK (`AuthenticateContext.usesSuffixedCookies()` /
 * `getSuffixedOrUnSuffixedCookie()`) writes `<name>_<publishableKeySuffix>` INSTEAD OF the bare
 * `<name>` whenever this instance's cookie would otherwise collide with another Clerk instance on
 * the same top-level domain — a real, currently-active mechanism, already confirmed to happen in
 * this deployment (#797, #7082): a signed-in member's browser carried only `__session_<suffix>` /
 * `__client_uat_<suffix>`, with no bare cookie present at all. The server-side helpers
 * (`clerk-session-cookies.ts`, `clerk-session-from-request.ts`) already scan every suffixed
 * variant for exactly this reason; this is the client-side (`document.cookie`) equivalent, so a
 * fourth bare-name-only reimplementation doesn't quietly reappear the next time a client
 * component needs this signal.
 */
export function clerkClientCookieValue(baseName: string): string | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie;
  if (!raw) return null;
  const prefix = `${baseName}_`;
  for (const pair of raw.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    if (name !== baseName && !name.startsWith(prefix)) continue;
    return pair.slice(eq + 1).trim();
  }
  return null;
}

/** True when ANY `<baseName>` or `<baseName>_<suffix>` cookie is present (value may be empty). */
export function clerkClientCookiePresent(baseName: string): boolean {
  return clerkClientCookieValue(baseName) !== null;
}
