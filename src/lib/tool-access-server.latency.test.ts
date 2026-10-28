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

test("userCanAccessTool JWT fast path uses the real tool_access claim, not a tier/role-only guess", () => {
  const src = readFileSync(join(root, "tool-access-server.ts"), "utf8");
  assert.match(src, /toolAccessModeFromSessionClaims/);
  // Regression guard for the fast-path bypass fixed in fix/tool-access-jwt-block-bypass:
  // "global launched + tier/role in token → true" treated "no tool_access claim" as "no
  // override", which silently ignored a real admin `block` override on an already-launched
  // tool (every tool except Largo). `sessionClaimsHaveAuthFields` must not gate a bare
  // `return true` in this function any more — the real override must always be consulted
  // (via the JWT claim when present, else the cached getUser read).
  assert.doesNotMatch(src, /sessionClaimsHaveAuthFields/);
});
