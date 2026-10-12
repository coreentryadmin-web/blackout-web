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
