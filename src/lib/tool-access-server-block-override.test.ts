// Behavioral coverage for userCanAccessTool's JWT fast path vs a real, admin-set per-user
// `tool_access` override (CLAUDE.md round 104 — fix/tool-access-jwt-block-bypass).
//
// Reproduces the bug directly rather than only asserting on source text: a user with a normal
// session JWT (tier + role claims, the documented Dashboard setup in
// docs/clerk/SESSION-TOKEN-CLAIMS.md — no `tool_access` claim) must still be denied access to an
// already-launched tool (e.g. "vector", defaultLaunched: true) once an admin has set a real
// `block` override in their Clerk publicMetadata.tool_access, even though the JWT itself carries
// no signal of that override at all.

import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
// `react`'s `cache()` is unavailable under tsx --test (CJS interop — same reason
// clerk-user-cache.ts's own header gives for not using it there). tool-access-server.ts's
// `loadUserToolAccess` only uses `cache` as a per-request memo; an identity passthrough is
// behaviorally fine for this test (each test case is its own fresh userId/call, never relying
// on cross-call memoization), and lets the real module load under the test runner at all.
mock.module("react", { namedExports: { cache: <T>(fn: T): T => fn } });
// admin-access.ts (a transitive import of tool-access-server.ts, for isAdminUser) pulls in
// next/navigation's `redirect` at module scope, which in turn pulls the real
// app-router-context.shared-runtime — that needs a real React.createContext the stubbed
// `react` mock above doesn't provide. requireAdmin (the only caller of `redirect` in
// admin-access.ts) is never exercised by userCanAccessTool, so a no-op stub is safe here.
mock.module("next/navigation", { namedExports: { redirect: () => {} } });

const clerkToolAccess = new Map<string, unknown>();
let getUserCalls = 0;

mock.module("./clerk-user-cache", {
  namedExports: {
    getClerkUserCached: async (userId: string) => {
      getUserCalls += 1;
      return { publicMetadata: { tool_access: clerkToolAccess.get(userId) } };
    },
  },
});

let userCanAccessTool: (
  userId: string,
  key: string,
  sessionClaims?: Record<string, unknown> | null,
) => Promise<boolean>;

before(async () => {
  const mod = await import("./tool-access-server.ts");
  userCanAccessTool = mod.userCanAccessTool as typeof userCanAccessTool;
});

test("userCanAccessTool: honors a real admin block on an already-launched tool even with no tool_access JWT claim", async () => {
  getUserCalls = 0;
  const userId = "u_blocked_vector";
  // Admin set a real block via POST /api/admin/users/tools/bulk or the single-user PATCH route.
  clerkToolAccess.set(userId, { vector: "block" });

  // Normal signed-in session JWT per docs/clerk/SESSION-TOKEN-CLAIMS.md: tier + role only,
  // no tool_access claim (tool_access is never added to the Dashboard JWT template).
  const claims = { tier: "premium", role: "member" };

  // "vector" is defaultLaunched: true, so the buggy fast path treated "no tool_access claim +
  // tool globally launched + tier/role present" as "no override" and returned true outright.
  const canAccess = await userCanAccessTool(userId, "vector", claims);

  assert.equal(
    canAccess,
    false,
    "a real admin block on a globally-launched tool must not be silently ignored just because the JWT lacks a tool_access claim",
  );
  assert.ok(getUserCalls >= 1, "must consult the real stored override via getClerkUserCached when the JWT carries no tool_access claim");
});

test("userCanAccessTool: still grants access to an already-launched tool with no override at all", async () => {
  getUserCalls = 0;
  const userId = "u_normal_vector";
  clerkToolAccess.set(userId, undefined);
  const claims = { tier: "premium", role: "member" };

  const canAccess = await userCanAccessTool(userId, "vector", claims);
  assert.equal(canAccess, true, "an ordinary member with no override must still get the globally-launched tool");
});

test("userCanAccessTool: a real admin grant override still works for a locked tool (largo)", async () => {
  getUserCalls = 0;
  const userId = "u_granted_largo";
  clerkToolAccess.set(userId, { largo: "grant" });
  const claims = { tier: "premium", role: "member" };

  const canAccess = await userCanAccessTool(userId, "largo", claims);
  assert.equal(canAccess, true, "an explicit grant override must unlock a non-launched tool");
});
