// REGRESSION (round 116, DISCOVERY-lane): setToolAccessForUserId used to do an UNLOCKED
// read-modify-write against a user's Clerk publicMetadata — `client.users.getUser(userId)`
// (read the WHOLE object) -> spread into a local copy -> set/delete `tool_access` -> write the
// WHOLE copy back via `updateUserMetadata`. Clerk's updateUserMetadata performs a server-side
// top-level MERGE of whatever keys are present in the payload (see updateClerkMembershipMetadata
// in membership.ts and setPersonalWebhook in personal-alert-store.ts, which both rely on exactly
// this and both say so in their own comments) — which means resending every OTHER currently-known
// field (tier, role, whop_user_id, ...) as part of this function's payload is not just redundant,
// it actively STOMPS any of those fields that changed concurrently between this function's read
// and its write, because the stale value is explicitly present in the merge payload it sends.
//
// Concrete path this is reachable from in production: POST /api/admin/users/tools/bulk iterates
// up to 500 users calling setToolAccessForUserId per user (a multi-round-trip operation that can
// run for a while), while a Whop webhook (membership.activated/deactivated) concurrently calls
// updateClerkMembershipMetadata to flip that SAME user's `tier` via a real partial-merge payload.
// If this function's getUser-captured stale snapshot still says the OLD tier, and its own
// updateUserMetadata call lands AFTER the webhook's, the webhook's tier change is silently
// reverted — a real lost update on a security/billing-relevant field, not just `tool_access`.
//
// The fake Clerk `clerkClient` below models Clerk's own documented merge semantics (a key
// present in the payload overwrites; `null` removes it; everything else untouched), and forces a
// real async gap inside `getUser` so a concurrent webhook-style write can land in the window
// between this function's read and its write — the exact interleaving that produces the bug.

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

mock.module("server-only", { namedExports: {} });
// Same reasons as tool-access-server-block-override.test.ts: `react`'s `cache()` doesn't work
// under tsx --test's CJS interop, and admin-access.ts's transitive next/navigation import needs a
// real React context the stub doesn't provide — neither matters for setToolAccessForUserId itself.
mock.module("react", { namedExports: { cache: <T>(fn: T): T => fn } });
mock.module("next/navigation", { namedExports: { redirect: () => {} } });

let metaStore = new Map<string, Record<string, unknown>>();

function makeClerkMock() {
  return {
    namedExports: {
      clerkClient: async () => ({
        users: {
          getUser: async (userId: string) => {
            // Snapshot captured NOW, at call time — exactly like a real Clerk read. The delay
            // below models the network round trip the caller has to wait out before it can act
            // on this (now potentially stale) snapshot.
            const snapshot = { ...(metaStore.get(userId) ?? {}) };
            await new Promise((r) => setTimeout(r, 5));
            return { publicMetadata: snapshot };
          },
          updateUserMetadata: async (
            userId: string,
            opts: { publicMetadata?: Record<string, unknown> }
          ) => {
            const current = metaStore.get(userId) ?? {};
            const merged = { ...current };
            for (const [k, v] of Object.entries(opts.publicMetadata ?? {})) {
              if (v === null || v === undefined) delete merged[k];
              else merged[k] = v;
            }
            metaStore.set(userId, merged);
          },
        },
      }),
    },
  };
}

mock.module("@clerk/nextjs/server", makeClerkMock());
mock.module("./clerk-user-cache", {
  namedExports: {
    getClerkUserCached: async (userId: string) => ({
      publicMetadata: metaStore.get(userId) ?? {},
    }),
    invalidateClerkUserCache: (_userId: string) => {},
  },
});

async function loadModule() {
  return import("./tool-access-server.ts");
}

describe("setToolAccessForUserId concurrency (unlocked publicMetadata read-modify-write)", () => {
  it("does not revert a concurrent tier change made by a Whop webhook mid-flight", async () => {
    const { setToolAccessForUserId } = await loadModule();
    const userId = "u_race_tier";
    metaStore = new Map([[userId, { tier: "free" }]]);

    const client = await (await import("@clerk/nextjs/server")).clerkClient();

    await Promise.all([
      // The admin bulk tool-access op: starts a getUser read that won't resolve for 5ms.
      setToolAccessForUserId(userId, { vector: "grant" }),
      // A concurrent Whop webhook flips tier via a real partial-merge write, landing well
      // inside the 5ms window while the call above is still awaiting its stale read.
      (async () => {
        await new Promise((r) => setTimeout(r, 1));
        await client.users.updateUserMetadata(userId, { publicMetadata: { tier: "premium" } });
      })(),
    ]);

    const final = metaStore.get(userId);
    assert.equal(
      final?.tier,
      "premium",
      "a concurrent tier change must survive a tool-access update — reverting to the stale " +
        "pre-webhook tier is exactly the lost-update race this guards against"
    );
    assert.deepEqual(
      final?.tool_access,
      { vector: "grant" },
      "the tool-access update itself must still land correctly"
    );
  });

  it("clearing tool_access (mode back to inherit for everything) does not touch other fields", async () => {
    const { setToolAccessForUserId } = await loadModule();
    const userId = "u_race_clear";
    metaStore = new Map([[userId, { tier: "premium", role: "member", tool_access: { largo: "grant" } }]]);

    const client = await (await import("@clerk/nextjs/server")).clerkClient();

    await Promise.all([
      setToolAccessForUserId(userId, {}), // compact map is empty -> clear tool_access entirely
      (async () => {
        await new Promise((r) => setTimeout(r, 1));
        await client.users.updateUserMetadata(userId, { publicMetadata: { role: "admin" } });
      })(),
    ]);

    const final = metaStore.get(userId);
    assert.equal(final?.tool_access, undefined, "tool_access must be cleared");
    assert.equal(final?.tier, "premium", "tier must be untouched");
    assert.equal(
      final?.role,
      "admin",
      "a concurrent role promotion must survive clearing someone's tool_access"
    );
  });
});
