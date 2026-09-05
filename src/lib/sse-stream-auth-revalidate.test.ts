// Behavioral coverage for revalidateSseStreamAccess (sse-stream-auth.ts) — the source-scan tests
// in sse-stream-auth.test.ts prove the function is CALLED by both SSE routes; this file proves the
// revalidation LOGIC itself behaves correctly under the actual Q41 scenarios (a tier that dropped,
// a revoked tool-launch override, and a transient tier-cache outage).

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

let revalidateSseStreamAccess: (ctx: {
  userId: string;
  minTier: "free" | "community" | "premium";
  toolKey?: string;
}) => Promise<"ok" | "forbidden" | "unavailable">;

before(async () => {
  ({ revalidateSseStreamAccess } = await import("./sse-stream-auth.ts"));
});

test("revalidateSseStreamAccess: premium tier at premium minTier, no toolKey — ok", async () => {
  tierForUser.set("u1", "premium");
  assert.equal(await revalidateSseStreamAccess({ userId: "u1", minTier: "premium" }), "ok");
});

test("revalidateSseStreamAccess: tier fell below minTier (Whop cancellation scenario) — forbidden", async () => {
  tierForUser.set("u2", "free");
  assert.equal(await revalidateSseStreamAccess({ userId: "u2", minTier: "premium" }), "forbidden");
});

test("revalidateSseStreamAccess: tier ok but tool-launch access revoked — forbidden", async () => {
  tierForUser.set("u3", "premium");
  toolAllowedForUser.set("u3", false);
  assert.equal(
    await revalidateSseStreamAccess({ userId: "u3", minTier: "premium", toolKey: "vector" }),
    "forbidden"
  );
  toolAllowedForUser.delete("u3");
});

test("revalidateSseStreamAccess: toolKey omitted — a tool-launch revocation is never checked", async () => {
  tierForUser.set("u4", "premium");
  toolAllowedForUser.set("u4", false);
  assert.equal(await revalidateSseStreamAccess({ userId: "u4", minTier: "premium" }), "ok");
  toolAllowedForUser.delete("u4");
});

test("revalidateSseStreamAccess: TierUnavailableError fails OPEN as 'unavailable', not 'forbidden'", async () => {
  tierBehavior.set("u5", "unavailable");
  assert.equal(await revalidateSseStreamAccess({ userId: "u5", minTier: "premium" }), "unavailable");
  tierBehavior.delete("u5");
});
