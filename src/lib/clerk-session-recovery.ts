import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/** Clerk session cookies that can go stale after key/domain migrations. */
export const CLERK_SESSION_COOKIE_NAMES = [
  "__session",
  "__client_uat",
  "__clerk_db_jwt",
] as const;

export function requestHasClerkSessionCookie(req: NextRequest | Request): boolean {
  const cookies = "cookies" in req ? req.cookies : null;
  if (!cookies) return false;
  return CLERK_SESSION_COOKIE_NAMES.some((name) => cookies.has(name));
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
