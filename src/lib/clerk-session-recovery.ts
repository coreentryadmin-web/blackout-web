import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/** Clerk session cookies that can go stale after key/domain migrations. */
export const CLERK_SESSION_COOKIE_NAMES = [
  "__session",
  "__client_uat",
  "__clerk_db_jwt",
] as const;

/**
 * Clerk cookie names that get a `_<publishableKeySuffix>` suffix instead of (not in addition
 * to) the bare name when this instance's session cookie collides with another Clerk instance
 * on the same top-level domain (see `@clerk/backend`'s `usesSuffixedCookies()`/
 * `getSuffixedOrUnSuffixedCookie()` — a real, current SDK mechanism, not legacy). Confirmed to
 * actually happen in THIS deployment by #797 (a signed-in member's browser carried ONLY
 * `__session_<suffix>`, no bare `__session` at all — "Homepage nav stayed on Sign in").
 * `__clerk_db_jwt` is not part of this mechanism, so it stays bare-only in the set above.
 */
const SUFFIXABLE_CLERK_COOKIE_PREFIXES = ["__session_", "__client_uat_"] as const;

export function requestHasClerkSessionCookie(req: NextRequest | Request): boolean {
  const cookies = "cookies" in req ? req.cookies : null;
  if (!cookies) return false;
  if (CLERK_SESSION_COOKIE_NAMES.some((name) => cookies.has(name))) return true;
  if (!("getAll" in cookies) || typeof cookies.getAll !== "function") return false;
  // #797's root cause, left unfixed here: a request whose ONLY Clerk cookies are the suffixed
  // variant must still read as "has a Clerk session signal" — the bare-name-only check above
  // reads a genuinely signed-in request (per `auth.protect()`, which Clerk's own SDK resolves
  // correctly via `getSuffixedOrUnSuffixedCookie()`) as fully signed-out.
  for (const c of cookies.getAll()) {
    if (SUFFIXABLE_CLERK_COOKIE_PREFIXES.some((prefix) => c.name.startsWith(prefix))) {
      return true;
    }
  }
  return false;
}

/** Expire Clerk session cookies so the browser stops sending invalid JWTs. */
export function clearClerkSessionCookies(res: NextResponse): void {
  for (const name of CLERK_SESSION_COOKIE_NAMES) {
    res.cookies.set(name, "", {
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });
  }
}

export function clerkSignInRecoveryUrl(req: NextRequest): URL {
  const signIn = new URL("/sign-in", req.url);
  const returnPath = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  if (returnPath && returnPath !== "/sign-in") {
    signIn.searchParams.set("redirect_url", returnPath);
  }
  return signIn;
}

/** Clear stale cookies and reload auth pages, or send protected routes to sign-in. */
export function clerkStaleCookieRecoveryResponse(req: NextRequest): NextResponse {
  const path = req.nextUrl.pathname;
  const isAuthPage =
    path === "/sign-in" ||
    path.startsWith("/sign-in/") ||
    path === "/sign-up" ||
    path.startsWith("/sign-up/");
  const target = isAuthPage
    ? new URL(`${path}${req.nextUrl.search}`, req.url)
    : clerkSignInRecoveryUrl(req);
  const res = NextResponse.redirect(target, 307);
  clearClerkSessionCookies(res);
  return res;
}
