import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  clerkIsClerkSyncFailed,
  clerkSanitizeStagingReturnUrl,
  clerkStagingReturnPath,
  clerkPostAuthReturnPath,
  isSafeAppRelativePath,
  CLERK_DEFAULT_POST_AUTH_PATH,
} from "./clerk-redirect-url";

const here = dirname(fileURLToPath(import.meta.url));

test("clerkSanitizeStagingReturnUrl: allows staging absolute URLs", () => {
  assert.equal(
    clerkSanitizeStagingReturnUrl("https://staging.blackouttrades.com/dashboard"),
    "https://staging.blackouttrades.com/dashboard"
  );
});

test("clerkSanitizeStagingReturnUrl: strips __clerk_synced", () => {
  assert.equal(
    clerkSanitizeStagingReturnUrl(
      "https://staging.blackouttrades.com/dashboard?__clerk_synced=false"
    ),
    "https://staging.blackouttrades.com/dashboard"
  );
});

test("clerkSanitizeStagingReturnUrl: rejects non-staging origins", () => {
  assert.equal(clerkSanitizeStagingReturnUrl("https://evil.example/phish"), null);
});

test("clerkStagingReturnPath: normalizes full staging URL to path", () => {
  assert.equal(
    clerkStagingReturnPath("https://staging.blackouttrades.com/spx?x=1"),
    "/spx?x=1"
  );
});

test("clerkStagingReturnPath: strips __clerk_db_jwt from a RELATIVE path, same as it already does for an absolute staging URL", () => {
  // BUG (fixed): clerkSanitizeStagingReturnUrl's absolute-URL branch has always deleted both
  // __clerk_synced and __clerk_db_jwt before returning. clerkStagingReturnPath's own
  // relative-path branch only deleted __clerk_synced, so the exact same query string reached a
  // different result depending solely on whether it arrived as a bare path or a full URL — a
  // relative redirect_url carrying __clerk_db_jwt (Clerk's real primary<->satellite session-sync
  // token) passed straight through un-stripped. middleware-clerk.ts's clerkIsClerkSyncFailed
  // recovery path feeds exactly this shape into clerkSatelliteAuthRedirect ->
  // clerkStagingReturnPath after deleting only __clerk_synced from the request URL itself.
  assert.equal(
    clerkStagingReturnPath("/sign-in?__clerk_db_jwt=deadbeef&__clerk_synced=false"),
    "/sign-in"
  );
  // Same input, as a full staging URL, already stripped both params before this fix — the two
  // call shapes must agree.
  assert.equal(
    clerkSanitizeStagingReturnUrl(
      "https://staging.blackouttrades.com/sign-in?__clerk_db_jwt=deadbeef&__clerk_synced=false"
    ),
    "https://staging.blackouttrades.com/sign-in"
  );
});

test("clerkPostAuthReturnPath: empty → marketing home", () => {
  assert.equal(clerkPostAuthReturnPath(undefined), CLERK_DEFAULT_POST_AUTH_PATH);
  assert.equal(clerkPostAuthReturnPath(""), CLERK_DEFAULT_POST_AUTH_PATH);
});

test("clerkPostAuthReturnPath: honors explicit path", () => {
  assert.equal(clerkPostAuthReturnPath("/flows"), "/flows");
});

test("clerkPostAuthReturnPath: rejects absolute URL (open redirect)", () => {
  assert.equal(clerkPostAuthReturnPath("https://evil.com/phish"), CLERK_DEFAULT_POST_AUTH_PATH);
});

test("clerkPostAuthReturnPath: rejects protocol-relative URL", () => {
  assert.equal(clerkPostAuthReturnPath("//evil.com"), CLERK_DEFAULT_POST_AUTH_PATH);
  assert.equal(clerkPostAuthReturnPath("//evil.com/phish"), CLERK_DEFAULT_POST_AUTH_PATH);
});

test("clerkPostAuthReturnPath: a repeated redirect_url query key (Next.js yields string[]) does not crash", () => {
  // Live production TypeError, 2026-09-26: "a?.trim is not a function" on /sign-up and
  // /sign-in — `searchParams.redirect_url` is `string | string[]` at runtime for a repeated
  // query key even though the route Props type only declared `string`. Must take the first
  // value, exactly like URLSearchParams.get() already does for the middleware caller.
  assert.equal(clerkPostAuthReturnPath(["/flows", "/dashboard"]), "/flows");
  assert.equal(clerkPostAuthReturnPath(["https://evil.com/phish"]), CLERK_DEFAULT_POST_AUTH_PATH);
  assert.equal(clerkPostAuthReturnPath([]), CLERK_DEFAULT_POST_AUTH_PATH);
});

test("isSafeAppRelativePath: only same-app paths", () => {
  assert.equal(isSafeAppRelativePath("/dashboard"), true);
  assert.equal(isSafeAppRelativePath("/flows?x=1"), true);
  assert.equal(isSafeAppRelativePath("//evil.com"), false);
  assert.equal(isSafeAppRelativePath("https://evil.com"), false);
  assert.equal(isSafeAppRelativePath("dashboard"), false);
});

test("isSafeAppRelativePath: rejects backslash-based host-jump bypasses", () => {
  // Per the WHATWG URL spec, a backslash is equivalent to a forward slash when resolving a
  // relative reference against an http(s) base, so these all open an authority (host) component
  // exactly like a literal `//` would — a naive `startsWith("/") && !startsWith("//")` check
  // misses every one of them. Confirmed live: new URL("/\\evil.com", "https://blackouttrades.com")
  // resolves to origin "https://evil.com".
  assert.equal(isSafeAppRelativePath("/\\evil.com"), false);
  assert.equal(isSafeAppRelativePath("/\\/evil.com"), false);
  assert.equal(isSafeAppRelativePath("/\\\\evil.com"), false);
  // A percent-encoded backslash is NOT a bypass — it stays a literal path segment, never
  // decoded into a path separator by the URL parser or the browser's own navigation.
  assert.equal(isSafeAppRelativePath("/%5Cevil.com"), true);
});

test("clerkPostAuthReturnPath: rejects backslash-based host-jump bypass end-to-end", () => {
  // The function is documented ("rejects absolute URL"/"rejects protocol-relative URL" above) to
  // never hand back anything but a same-app path. A backslash variant must land on the same
  // default, not silently resolve toward evil.com.
  assert.equal(clerkPostAuthReturnPath("/\\evil.com/secret"), CLERK_DEFAULT_POST_AUTH_PATH);
  assert.equal(clerkPostAuthReturnPath("/\\/evil.com/phish"), CLERK_DEFAULT_POST_AUTH_PATH);
});

test("middleware uses clerkPostAuthReturnPath for signed-in auth redirect", () => {
  const src = readFileSync(join(here, "../middleware-clerk.ts"), "utf8");
  assert.match(src, /clerkPostAuthReturnPath\(req\.nextUrl\.searchParams\.get\("redirect_url"\)\)/);
  // Must not pass raw redirect_url into new URL(...) — that is the open-redirect bug.
  assert.doesNotMatch(
    src,
    /const dest = req\.nextUrl\.searchParams\.get\("redirect_url"\) \|\|/
  );
});

test("clerkIsClerkSyncFailed", () => {
  assert.equal(
    clerkIsClerkSyncFailed(new URL("https://staging.blackouttrades.com/dashboard?__clerk_synced=false")),
    true
  );
  assert.equal(
    clerkIsClerkSyncFailed(new URL("https://staging.blackouttrades.com/dashboard")),
    false
  );
});
