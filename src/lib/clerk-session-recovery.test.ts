import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";
import {
  clerkSignInRecoveryUrl,
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

test("clerkSignInRecoveryUrl preserves return path", () => {
  const req = new NextRequest("https://blackouttrades.com/flows?tab=live");
  const url = clerkSignInRecoveryUrl(req);
  assert.equal(url.pathname, "/sign-in");
  assert.equal(url.searchParams.get("redirect_url"), "/flows?tab=live");
});

test("clearClerkSessionCookies expires known Clerk cookies", () => {
  const redirect = NextResponse.redirect("https://blackouttrades.com/sign-in");
  clearClerkSessionCookies(redirect);
  const setCookie = redirect.headers.getSetCookie();
  assert.ok(setCookie.some((c) => c.startsWith("__session=")));
  assert.ok(setCookie.some((c) => c.startsWith("__client_uat=")));
});
