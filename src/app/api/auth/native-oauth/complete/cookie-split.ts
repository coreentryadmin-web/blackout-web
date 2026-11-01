/**
 * Split a "cookie1=..; cookie2=.." string into a Set-Cookie header array.
 *
 * Splits each pair on the FIRST "=" only (`indexOf`, not `split("=")`), the same correct
 * pattern this repo already established in `clerk-client-cookie.ts` for the same reason: a
 * naive `const [name, value] = kv.split("=")` silently DROPS everything after a second "="
 * in the value — `"session=abc.def=ghi".split("=")` is `["session","abc.def","ghi"]`, so
 * destructuring only the first two elements truncates the cookie to `session=abc.def`,
 * losing `=ghi` with no error anywhere.
 *
 * Lives in its own file (not `route.ts`) because Next.js's route-export type checker rejects
 * any export from a `route.ts` file that isn't one of its known route fields (GET/POST/runtime/
 * dynamic/etc.) — a plain helper exported alongside `POST` fails `next build`'s type check with
 * "is not a valid Route export field" even though it runs fine under the test runner.
 *
 * Not currently reachable with a live Clerk `__session` JWT (JWS base64url encoding omits
 * "=" padding per RFC 7515, and `__client_uat` is a bare epoch integer) — but this is a
 * general-purpose cookie-header splitter, the exact kind of helper that gets reused the next
 * time a cookie value legitimately contains "=", and it would then truncate silently rather
 * than failing loudly.
 */
export function splitCookieHeader(joined: string): string[] {
  return joined
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((kv) => {
      const eq = kv.indexOf("=");
      const name = eq === -1 ? kv : kv.slice(0, eq);
      const value = eq === -1 ? "" : kv.slice(eq + 1);
      // Match Clerk's own cookie attributes: domain-wide (works across the
      // WebView + web), HttpOnly (Clerk sets __session HttpOnly too),
      // Secure, SameSite=Lax so it survives the redirect chain.
      // Path=/ so every route including SSE endpoints sees it.
      return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax`;
    });
}
