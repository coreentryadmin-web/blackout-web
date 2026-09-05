// Behavioral coverage for recheckSseUserEntitlement — proves the revalidation logic
// under Q41 scenarios (tier drop, tool-launch revocation, transient tier outage).

import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

class FakeTierUnavailableError extends Error {}

const tierForUser = new Map<string, string>();
const tierBehavior = new Map<string, "unavailable">();
const toolAllowedForUser = new Map<string, boolean>();
const adminUsers = new Set<string>();

mock.module("./tier-cache", {
  namedExports: {
    resolveUserTier: async (userId: string) => {
      if (tierBehavior.get(userId) === "unavailable") throw new FakeTierUnavailableError();
      return tierForUser.get(userId) ?? "free";
    },
    TierUnavailableError: FakeTierUnavailableError,
  },
});

mock.module("./tool-access-server", {
  namedExports: {
    userCanAccessTool: async (userId: string) => toolAllowedForUser.get(userId) ?? true,
  },
});

mock.module("./admin-access", {
  namedExports: {
    isAdminUser: async (userId: string) => adminUsers.has(userId),
  },
});

let recheckSseUserEntitlement: (ctx: {
  userId: string;
  minTier: "free" | "community" | "premium";
  tool?: string;
}) => Promise<"ok" | "forbidden" | "unavailable">;

before(async () => {
  ({ recheckSseUserEntitlement } = await import("./sse-stream-entitlement.ts"));
});

test("recheckSseUserEntitlement: premium tier at premium minTier — ok", async () => {
  tierForUser.set("u1", "premium");
  assert.equal(
    await recheckSseUserEntitlement({ userId: "u1", minTier: "premium" }),
    "ok"
  );
});

test("recheckSseUserEntitlement: tier fell below minTier — forbidden", async () => {
  tierForUser.set("u2", "free");
  assert.equal(
    await recheckSseUserEntitlement({ userId: "u2", minTier: "premium" }),
    "forbidden"
  );
});

test("recheckSseUserEntitlement: tier ok but tool-launch access revoked — forbidden", async () => {
  tierForUser.set("u3", "premium");
  toolAllowedForUser.set("u3", false);
  assert.equal(
    await recheckSseUserEntitlement({ userId: "u3", minTier: "premium", tool: "vector" }),
    "forbidden"
  );
  toolAllowedForUser.delete("u3");
});

test("recheckSseUserEntitlement: admin bypasses tier but still checks tool gate", async () => {
  adminUsers.add("admin1");
  tierForUser.set("admin1", "free");
  toolAllowedForUser.set("admin1", false);
  assert.equal(
    await recheckSseUserEntitlement({ userId: "admin1", minTier: "premium", tool: "vector" }),
    "forbidden"
  );
  toolAllowedForUser.delete("admin1");
  assert.equal(
    await recheckSseUserEntitlement({ userId: "admin1", minTier: "premium", tool: "vector" }),
    "ok"
  );
  adminUsers.delete("admin1");
});

test("recheckSseUserEntitlement: TierUnavailableError fails OPEN as unavailable", async () => {
  tierBehavior.set("u5", "unavailable");
  assert.equal(
    await recheckSseUserEntitlement({ userId: "u5", minTier: "premium" }),
    "unavailable"
  );
  tierBehavior.delete("u5");
});
