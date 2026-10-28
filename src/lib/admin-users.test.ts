import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertAdminSelfGuard,
  buildAdminUserFilterSql,
  computeAdminUserListStats,
  isValidCreateUserTier,
  parseAdminUserRole,
  parseAdminUserTier,
  shouldUseDbAdminUserList,
} from "./admin-users";

test("parseAdminUserRole accepts admin and member", () => {
  assert.equal(parseAdminUserRole("admin"), "admin");
  assert.equal(parseAdminUserRole("member"), "member");
  assert.equal(parseAdminUserRole(""), "member");
  assert.equal(parseAdminUserRole(undefined), "member");
  assert.equal(parseAdminUserRole("superuser"), undefined);
});

test("parseAdminUserTier accepts only the three canonical tiers, rejects everything else", () => {
  assert.equal(parseAdminUserTier("free"), "free");
  assert.equal(parseAdminUserTier("community"), "community");
  assert.equal(parseAdminUserTier("premium"), "premium");
  // Unlike parseTier (lib/tiers.ts), this must REJECT rather than silently coerce to "free" —
  // it gates an admin mutation, where a typo/alias should 400, not quietly demote the member.
  assert.equal(parseAdminUserTier("pro"), undefined);
  assert.equal(parseAdminUserTier("elite"), undefined);
  assert.equal(parseAdminUserTier("Premium"), undefined);
  assert.equal(parseAdminUserTier(""), undefined);
  assert.equal(parseAdminUserTier(undefined), undefined);
  assert.equal(parseAdminUserTier(null), undefined);
});

test("isValidCreateUserTier accepts only the canonical tiers", () => {
  assert.equal(isValidCreateUserTier("free"), true);
  assert.equal(isValidCreateUserTier("community"), true);
  assert.equal(isValidCreateUserTier("premium"), true);
});

test("isValidCreateUserTier rejects legacy aliases and malformed values", () => {
  assert.equal(isValidCreateUserTier("pro"), false);
  assert.equal(isValidCreateUserTier("elite"), false);
  assert.equal(isValidCreateUserTier("Premium"), false);
  assert.equal(isValidCreateUserTier("superuser"), false);
  assert.equal(isValidCreateUserTier(123), false);
  assert.equal(isValidCreateUserTier(null), false);
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

test("computeAdminUserListStats excludes internal audit/test-harness accounts from every bucket", () => {
  // Live repro (2026-10-26): an audit harness's default publicMetadata is
  // {role:"admin", tier:"premium"} — without the exclusion these rows inflate "admins" and
  // leave Premium/Free/Community at 0 even when real members of those tiers exist.
  const rows = [
    { email: "claude-audit-temp+jiadd@blackouttrades.com", tier: "premium", role: "admin", membership_kind: null },
    { email: "real.premium.member@gmail.com", tier: "premium", role: null, membership_kind: null },
    { email: "real.free.member@gmail.com", tier: "free", role: null, membership_kind: "free" },
  ];
  const stats = computeAdminUserListStats(rows, []);
  assert.deepEqual(stats, { total: 2, premium: 1, admins: 0, community: 0, free: 1 });
});

test("computeAdminUserListStats: admin bucket wins over premium/community/free, allowlisted email also counts as admin", () => {
  const rows = [
    { email: "staff@blackouttrades.com", tier: "premium", role: null, membership_kind: null },
    { email: "role-admin@blackouttrades.com", tier: "free", role: "admin", membership_kind: "community" },
  ];
  const stats = computeAdminUserListStats(rows, ["staff@blackouttrades.com"]);
  assert.deepEqual(stats, { total: 2, premium: 0, admins: 2, community: 0, free: 0 });
});

test("buildAdminUserFilterSql community clauses exclude premium-tier users, matching classifyAdminUserAccess's priority order", () => {
  // classifyAdminUserAccess (admin-user-access.ts) classifies a user with
  // membership_kind='community' AND tier='premium' as "premium" — tier wins. Both community
  // SQL clauses here must apply the same exclusion, or access=community/tier=community
  // filtering returns a different set than the row's own accessLabel badge claims, and the
  // premium+community stat buckets double-count that user (sum exceeds total).
  const accessCommunity = buildAdminUserFilterSql({ access: "community" });
  assert.match(accessCommunity.whereSql, /membership_kind = 'community'/);
  assert.match(accessCommunity.whereSql, /COALESCE\(tier, 'free'\) <> 'premium'/);

  const tierCommunity = buildAdminUserFilterSql({ tier: "community" });
  assert.match(tierCommunity.whereSql, /membership_kind = 'community'/);
  assert.match(tierCommunity.whereSql, /COALESCE\(tier, 'free'\) <> 'premium'/);
});
