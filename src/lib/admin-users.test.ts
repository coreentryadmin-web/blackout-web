import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertAdminSelfGuard,
  buildAdminUserFilterSql,
  parseAdminUserRole,
  shouldUseDbAdminUserList,
} from "./admin-users";

test("parseAdminUserRole accepts admin and member", () => {
  assert.equal(parseAdminUserRole("admin"), "admin");
  assert.equal(parseAdminUserRole("member"), "member");
  assert.equal(parseAdminUserRole(""), "member");
  assert.equal(parseAdminUserRole(undefined), "member");
  assert.equal(parseAdminUserRole("superuser"), undefined);
});

test("assertAdminSelfGuard blocks self ban and demote", () => {
  assert.equal(assertAdminSelfGuard("u1", "u2", "ban"), null);
  assert.match(assertAdminSelfGuard("u1", "u1", "ban")!, /cannot ban/i);
  assert.match(assertAdminSelfGuard("u1", "u1", "demote")!, /admin role/i);
  assert.match(assertAdminSelfGuard("u1", "u1", "delete")!, /cannot delete/i);
});

test("shouldUseDbAdminUserList when tier, role, or access filter set", () => {
  assert.equal(shouldUseDbAdminUserList({}), false);
  assert.equal(shouldUseDbAdminUserList({ query: "foo" }), false);
  assert.equal(shouldUseDbAdminUserList({ tier: "premium" }), true);
  assert.equal(shouldUseDbAdminUserList({ role: "admin" }), true);
  assert.equal(shouldUseDbAdminUserList({ access: "free" }), true);
});

test("buildAdminUserFilterSql maps tier and role filters", () => {
  const premium = buildAdminUserFilterSql({ tier: "premium" });
  assert.match(premium.whereSql, /tier = 'premium'/);

  const community = buildAdminUserFilterSql({ tier: "community" });
  assert.match(community.whereSql, /membership_kind = 'community'/);

  const admin = buildAdminUserFilterSql({ role: "admin" });
  assert.match(admin.whereSql, /role = 'admin'/);

  const combined = buildAdminUserFilterSql({ tier: "free", role: "member" });
  assert.match(combined.whereSql, /tier = 'free'/);
  assert.match(combined.whereSql, /<> 'admin'/);

  const accessPremium = buildAdminUserFilterSql({ access: "premium" });
  assert.match(accessPremium.whereSql, /tier = 'premium'/);
  assert.match(accessPremium.whereSql, /<> 'admin'/);

  const accessFree = buildAdminUserFilterSql({ access: "free" });
  assert.match(accessFree.whereSql, /tier = 'free'/);
  assert.match(accessFree.whereSql, /NOT IN \('community', 'premium'\)/);
});
