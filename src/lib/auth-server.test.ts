import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("auth-server dedupes session reads with React.cache per request", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/auth-server.ts"), "utf8");
  assert.match(src, /cache\(async \(\): Promise<AppSession>/);
  assert.match(src, /export const auth = cache/);
});

test("requireTier uses one getSession and JWT tier fast path before Clerk getUser", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/auth-access.ts"), "utf8");
  assert.match(src, /tierFromSessionClaims/);
  assert.doesNotMatch(src, /await requireAuth\(\)/);
  const getSessionCalls = src.match(/getSession\(\)/g) ?? [];
  assert.ok(getSessionCalls.length <= 2, `expected ≤2 getSession calls, got ${getSessionCalls.length}`);
});
