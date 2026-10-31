import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";
import {
  clerkSignInRecoveryUrl,
  clerkStaleCookieRecoveryResponse,
  clearClerkSessionCookies,
  requestHasClerkSessionCookie,
} from "./clerk-session-recovery";

test("requestHasClerkSessionCookie detects session cookies", () => {
  const req = new NextRequest("https://blackouttrades.com/dashboard", {
    headers: { cookie: "__session=bad; __client_uat=1" },
  });
  assert.equal(requestHasClerkSessionCookie(req), true);
  const clean = new NextRequest("https://blackouttrades.com/dashboard");
  assert.equal(requestHasClerkSessionCookie(clean), false);
});

test("requestHasClerkSessionCookie detects a SUFFIXED-only session (real #797 scenario)", () => {
  // Clerk writes __session_<publishableKeySuffix> / __client_uat_<publishableKeySuffix>
  // instead of the bare names when this instance's session cookie collides with another
  // Clerk instance on the same top-level domain — confirmed live in #797 (a signed-in member
  // whose browser carried ONLY the suffixed cookie, no bare __session at all). A caller that
  // checks only the bare names reads that genuinely signed-in request as fully signed-out.
  const suffixedOnly = new NextRequest("https://blackouttrades.com/dashboard", {
    headers: { cookie: "__session_AbCdEf12=real.jwt.value; __client_uat_AbCdEf12=1700000000" },
  });
  assert.equal(requestHasClerkSessionCookie(suffixedOnly), true);

  const noClerkCookieAtAll = new NextRequest("https://blackouttrades.com/dashboard", {
    headers: { cookie: "some_other_cookie=1" },
  });
  assert.equal(requestHasClerkSessionCookie(noClerkCookieAtAll), false);
});

test("clerkSignInRecoveryUrl preserves return path", () => {
  const req = new NextRequest("https://blackouttrades.com/flows?tab=live");
  const url = clerkSignInRecoveryUrl(req);
  assert.equal(url.pathname, "/sign-in");
  assert.equal(url.searchParams.get("redirect_url"), "/flows?tab=live");
});

test("clerkStaleCookieRecoveryResponse reloads sign-in when already on auth page", () => {
  const req = new NextRequest("https://blackouttrades.com/sign-in?redirect_url=%2Fdashboard");
  const res = clerkStaleCookieRecoveryResponse(req);
  assert.equal(res.status, 307);
  assert.equal(res.headers.get("location"), "https://blackouttrades.com/sign-in?redirect_url=%2Fdashboard");
});

test("clerkStaleCookieRecoveryResponse sends desk routes to sign-in", () => {
  const req = new NextRequest("https://blackouttrades.com/flows");
  const res = clerkStaleCookieRecoveryResponse(req);
  assert.equal(res.status, 307);
  assert.match(res.headers.get("location") ?? "", /\/sign-in\?redirect_url=%2Fflows$/);
});

test("clearClerkSessionCookies expires known Clerk cookies", () => {
  const redirect = NextResponse.redirect("https://blackouttrades.com/sign-in");
  clearClerkSessionCookies(redirect);
  const setCookie = redirect.headers.getSetCookie();
  assert.ok(setCookie.some((c) => c.startsWith("__session=")));
  assert.ok(setCookie.some((c) => c.startsWith("__client_uat=")));
});
