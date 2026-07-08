import { test } from "node:test";
import assert from "node:assert/strict";
import { clerkSanitizeStagingReturnUrl } from "./clerk-redirect-url";

test("clerkSanitizeStagingReturnUrl: strips __clerk_synced on staging", () => {
  assert.equal(
    clerkSanitizeStagingReturnUrl(
      "https://staging.blackouttrades.com/dashboard?__clerk_synced=false"
    ),
    "https://staging.blackouttrades.com/dashboard"
  );
});

test("clerkSanitizeStagingReturnUrl: rejects evil origins", () => {
  assert.equal(clerkSanitizeStagingReturnUrl("https://evil.example/"), null);
});
