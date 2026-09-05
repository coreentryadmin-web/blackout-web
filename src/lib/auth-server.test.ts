import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("auth-server dedupes session reads with requestCache per request", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/auth-server.ts"), "utf8");
  assert.match(src, /requestCache\(async \(\): Promise<AppSession>/);
  assert.match(src, /export const auth = requestCache/);
});

test("requireTier uses resolveUserTier not JWT tier claims (CQ-113)", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/auth-access.ts"), "utf8");
  assert.doesNotMatch(src, /tierFromSessionClaims/);
  assert.match(src, /resolveUserTier|getUserTier/);
  assert.doesNotMatch(src, /await requireAuth\(\)/);
  assert.match(src, /requireDeskTool/);
  const getSessionCalls = src.match(/getSession\(\)/g) ?? [];
  assert.ok(getSessionCalls.length <= 2, `expected ≤2 getSession calls, got ${getSessionCalls.length}`);
});
