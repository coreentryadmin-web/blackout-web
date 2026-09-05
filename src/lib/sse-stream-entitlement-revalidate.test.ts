// Behavioral coverage for recheckSseUserEntitlement — source-scan tests prove the function is
// CALLED by all SSE routes; this file proves the revalidation LOGIC under Q41 scenarios.

import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

class FakeTierUnavailableError extends Error {}

const tierForUser = new Map<string, string>();
const tierBehavior = new Map<string, "unavailable">();
const toolAllowedForUser = new Map<string, boolean>();

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

let recheckSseUserEntitlement: (
  userId: string,
  minTier: "free" | "community" | "premium",
  tool?: string,
) => Promise<"ok" | "forbidden" | "unavailable">;

before(async () => {
  ({ recheckSseUserEntitlement } = await import("./sse-stream-entitlement.ts"));
});

test("recheckSseUserEntitlement: premium tier at premium minTier, no tool — ok", async () => {
  tierForUser.set("u1", "premium");
  assert.equal(await recheckSseUserEntitlement("u1", "premium"), "ok");
});

test("recheckSseUserEntitlement: tier fell below minTier (Whop cancellation) — forbidden", async () => {
  tierForUser.set("u2", "free");
  assert.equal(await recheckSseUserEntitlement("u2", "premium"), "forbidden");
});

test("recheckSseUserEntitlement: tier ok but tool-launch access revoked — forbidden", async () => {
  tierForUser.set("u3", "premium");
  toolAllowedForUser.set("u3", false);
  assert.equal(await recheckSseUserEntitlement("u3", "premium", "vector"), "forbidden");
  toolAllowedForUser.delete("u3");
});

test("recheckSseUserEntitlement: tool omitted — tool-launch revocation is never checked", async () => {
  tierForUser.set("u4", "premium");
  toolAllowedForUser.set("u4", false);
  assert.equal(await recheckSseUserEntitlement("u4", "premium"), "ok");
  toolAllowedForUser.delete("u4");
});

test("recheckSseUserEntitlement: TierUnavailableError fails OPEN as unavailable", async () => {
  tierBehavior.set("u5", "unavailable");
  assert.equal(await recheckSseUserEntitlement("u5", "premium"), "unavailable");
  tierBehavior.delete("u5");
});
