import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Latency regression guards for the auth-gate Clerk storm (P0).
 * If these strings drift, members pay 300–900ms extra TTFB again on every desk page.
 */
const root = join(process.cwd(), "src/lib");

test("isAdminUser short-circuits JWT member via adminFromJwtRole", () => {
  const src = readFileSync(join(root, "admin-access.ts"), "utf8");
  assert.match(src, /adminFromJwtRole/);
  assert.match(src, /getClerkUserCached/);
  assert.match(src, /claims === undefined/);
});

test("canAccessTool passes sessionClaims into userCanAccessTool (no getAdminStatus detour)", () => {
  const src = readFileSync(join(root, "tool-access-server.ts"), "utf8");
  assert.match(src, /userCanAccessTool\(\s*userId,\s*key,\s*sessionClaims/);
  // Page gate must not call getAdminStatus( — that was the extra getUserProfile round-trip.
  assert.doesNotMatch(src, /getAdminStatus\s*\(/);
  assert.match(src, /getClerkUserCached/);
});

test("userCanAccessTool accepts sessionClaims for JWT admin short-circuit", () => {
  const src = readFileSync(join(root, "tool-access-server.ts"), "utf8");
  assert.match(
    src,
    /export async function userCanAccessTool\(\s*userId: string,\s*key: ToolKey,\s*sessionClaims\?/
  );
  assert.match(src, /isAdminUser\(userId, sessionClaims\)/);
});

test("userCanAccessTool JWT fast path skips getUser for launched tools when tier/role in token", () => {
  const src = readFileSync(join(root, "tool-access-server.ts"), "utf8");
  assert.match(src, /sessionClaimsHaveAuthFields/);
  assert.match(src, /toolAccessModeFromSessionClaims/);
});
