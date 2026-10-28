import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAdminUserAccess } from "./admin-user-access";

test("classifyAdminUserAccess: admin role gets desk", () => {
  const r = classifyAdminUserAccess({ tier: "free", role: "admin" });
  assert.equal(r.accessLabel, "admin");
  assert.equal(r.deskAccess, true);
});

test("classifyAdminUserAccess: ADMIN_EMAILS flag gets admin bucket", () => {
  const r = classifyAdminUserAccess({ tier: "free", role: "", emailAdmin: true });
  assert.equal(r.accessLabel, "admin");
  assert.equal(r.deskAccess, true);
});

test("classifyAdminUserAccess: premium tier gets desk", () => {
  const r = classifyAdminUserAccess({ tier: "premium", role: "" });
  assert.equal(r.accessLabel, "premium");
  assert.equal(r.deskAccess, true);
});

test("classifyAdminUserAccess: community without premium", () => {
  const r = classifyAdminUserAccess({ tier: "free", membershipKind: "community" });
  assert.equal(r.accessLabel, "community");
  assert.equal(r.deskAccess, true);
});

test("classifyAdminUserAccess: tier=community set directly (admin manual grant, no membershipKind)", () => {
  // Edit/Create User modal lets an admin set tier="community" directly without ever touching
  // membershipKind (src/app/api/admin/users/[id]/route.ts's PATCH handler) — real desk access
  // (tierAtLeast in src/lib/tiers.ts) is granted off tier alone, so the admin-facing label must
  // match, not fall through to "free" just because membershipKind was never set.
  const r = classifyAdminUserAccess({ tier: "community", membershipKind: null });
  assert.equal(r.accessLabel, "community");
  assert.equal(r.deskAccess, true);
});

test("classifyAdminUserAccess: free signup", () => {
  const r = classifyAdminUserAccess({ tier: "free", membershipKind: "free" });
  assert.equal(r.accessLabel, "free");
  assert.equal(r.deskAccess, false);
});

test("classifyAdminUserAccess: admin wins over premium tier metadata", () => {
  const r = classifyAdminUserAccess({ tier: "premium", role: "admin" });
  assert.equal(r.accessLabel, "admin");
});

// Regression (2026-10-26): `parseTier` (src/lib/tiers.ts) treats the legacy tier literals
// "pro"/"elite" as "premium" for the member-facing desk gate (tier-cache.ts's resolveUserTier),
// but this function compared `input.tier === "premium"` literally instead of normalizing
// through parseTier first. A legacy member whose Clerk publicMetadata.tier is still "pro" or
// "elite" (pre-dating the "premium" literal) therefore has REAL premium desk access on the
// live site right now, while the admin dashboard — the only place an operator checks a
// member's access — showed them bucketed as "free" with deskAccess:false ("Free signup —
// marketing site + /upgrade only"), a materially wrong read of a real paying member's access.
test("classifyAdminUserAccess: legacy 'pro'/'elite' tier aliases resolve to premium, not free", () => {
  const pro = classifyAdminUserAccess({ tier: "pro", role: "" });
  assert.equal(pro.accessLabel, "premium");
  assert.equal(pro.deskAccess, true);

  const elite = classifyAdminUserAccess({ tier: "elite", role: "" });
  assert.equal(elite.accessLabel, "premium");
  assert.equal(elite.deskAccess, true);
});
