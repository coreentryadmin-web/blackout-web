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

test("isSafeAppRelativePath: only same-app paths", () => {
  assert.equal(isSafeAppRelativePath("/dashboard"), true);
  assert.equal(isSafeAppRelativePath("/flows?x=1"), true);
  assert.equal(isSafeAppRelativePath("//evil.com"), false);
  assert.equal(isSafeAppRelativePath("https://evil.com"), false);
  assert.equal(isSafeAppRelativePath("dashboard"), false);
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
