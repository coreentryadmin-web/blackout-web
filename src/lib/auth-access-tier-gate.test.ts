import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("requireTier does not JWT-fast-path paid tier (CQ-113 page gate)", () => {
  const src = readFileSync("src/lib/auth-access.ts", "utf8");
  assert.doesNotMatch(src, /tierFromSessionClaims/);
  assert.match(src, /resolveUserTier|getUserTier/);
});
