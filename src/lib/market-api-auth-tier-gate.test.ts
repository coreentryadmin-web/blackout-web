// Functional (behavioral) tier-gate coverage for market-api-auth — closes CQ-173 / CCQ-014.
// Static regex tests in market-api-auth-premium-gate.test.ts prove call sites exist; this file
// proves authorizePremiumDeskApi / requireTierApi actually return 403 for under-tier callers.

import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

class FakeTierUnavailableError extends Error {}

const tierForUser = new Map<string, string>();
const adminUsers = new Set<string>();
let signedInUserId: string | null = null;
let sessionClaims: Record<string, unknown> | undefined;

// mock.module() resolves specifiers relative to this file, not through the "@/" tsconfig
// alias — same pattern as src/app/api/public/email-capture/route.test.ts.
mock.module("./auth-server", {
  namedExports: {
    auth: async () => ({ userId: signedInUserId, sessionClaims }),
  },
});

mock.module("./tier-cache", {
  namedExports: {
    resolveUserTier: async (userId: string) => {
      if (!tierForUser.has(userId)) return "free";
      return tierForUser.get(userId)!;
    },
    TierUnavailableError: FakeTierUnavailableError,
  },
});

mock.module("./admin-access", {
  namedExports: {
    isAdminUser: async (userId: string) => adminUsers.has(userId),
  },
});

let requireTierApi: (minTier: "free" | "community" | "premium") => Promise<
  { userId: string; tier: string } | Response
>;
let authorizePremiumDeskApi: (req: NextRequest) => Promise<
  { userId: string | null; via: "cron" | "user" } | Response
>;

const fakeReq = new Request("http://localhost/api/market/vector/universe") as NextRequest;

before(async () => {
  const mod = await import("./market-api-auth.ts");
  requireTierApi = mod.requireTierApi;
  authorizePremiumDeskApi = mod.authorizePremiumDeskApi;
});

test("requireTierApi returns 401 when unsigned", async () => {
  signedInUserId = null;
  const res = await requireTierApi("premium");
  assert.ok(res instanceof Response);
  assert.equal(res.status, 401);
});

test("requireTierApi returns 403 for community caller at premium minTier", async () => {
  signedInUserId = "user_community";
  tierForUser.set("user_community", "community");
  const res = await requireTierApi("premium");
  assert.ok(res instanceof Response);
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? "", /upgrade required/i);
});

test("requireTierApi allows premium caller at premium minTier", async () => {
  signedInUserId = "user_premium";
  tierForUser.set("user_premium", "premium");
  const res = await requireTierApi("premium");
  assert.ok(!(res instanceof Response));
  assert.equal(res.userId, "user_premium");
  assert.equal(res.tier, "premium");
});

test("authorizePremiumDeskApi returns 403 for free-tier user (vector/universe gate)", async () => {
  signedInUserId = "user_free";
  tierForUser.set("user_free", "free");
  const res = await authorizePremiumDeskApi(fakeReq);
  assert.ok(res instanceof Response);
  assert.equal(res.status, 403);
});

test("authorizePremiumDeskApi allows cron secret without user session", async () => {
  signedInUserId = null;
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "tier-gate-test-secret";
  try {
    const req = new Request("http://localhost/api/market/vector/universe", {
      headers: { authorization: "Bearer tier-gate-test-secret" },
    }) as NextRequest;
    const res = await authorizePremiumDeskApi(req);
    assert.ok(!(res instanceof Response));
    assert.equal(res.via, "cron");
    assert.equal(res.userId, null);
  } finally {
    if (prev !== undefined) process.env.CRON_SECRET = prev;
    else delete process.env.CRON_SECRET;
  }
});
