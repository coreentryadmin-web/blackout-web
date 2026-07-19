import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clerkIsClerkSyncFailed,
  clerkSanitizeStagingReturnUrl,
  clerkStagingReturnPath,
  clerkPostAuthReturnPath,
  CLERK_DEFAULT_POST_AUTH_PATH,
} from "./clerk-redirect-url";

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

test("clerkPostAuthReturnPath: empty → dashboard", () => {
  assert.equal(clerkPostAuthReturnPath(undefined), CLERK_DEFAULT_POST_AUTH_PATH);
  assert.equal(clerkPostAuthReturnPath(""), CLERK_DEFAULT_POST_AUTH_PATH);
});

test("clerkPostAuthReturnPath: honors explicit path", () => {
  assert.equal(clerkPostAuthReturnPath("/flows"), "/flows");
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
