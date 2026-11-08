import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertAdminSelfGuard,
  buildAdminUserFilterSql,
  computeAdminUserListStats,
  isValidCreateUserTier,
  parseAdminUserRole,
  parseAdminUserTier,
  shouldApplyWhopSyncToCreatedUser,
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

// Regression (round 171, DISCOVERY-lane): POST /api/admin/users/create always sets
// `tier_managed_by: "admin"` on the account it just created, then calls
// syncWhopMembershipForEmail on the SAME email WITHOUT { ignoreAdminTierLock: true } (unlike
// sync/route.ts's explicit sync button, which passes it). That lock makes the sync a guaranteed
// no-op for the user it just created — `updatedUserIds` comes back empty and `tier`/`billingKind`
// default to "free" regardless of whether the email has a real, active Whop membership. The
// create route used to write that resolved value into the admin_users DB cache row
// UNCONDITIONALLY, silently stomping whatever tier the admin had just explicitly chosen (e.g.
// "premium") back to "free" in the DB cache on every single create.
test("shouldApplyWhopSyncToCreatedUser is false when the sync never touched the new user (the admin-lock no-op case)", () => {
  assert.equal(shouldApplyWhopSyncToCreatedUser("user_new", []), false);
  assert.equal(shouldApplyWhopSyncToCreatedUser("user_new", ["user_other"]), false);
});

test("shouldApplyWhopSyncToCreatedUser is true when the sync genuinely updated the new user", () => {
  assert.equal(shouldApplyWhopSyncToCreatedUser("user_new", ["user_new"]), true);
  assert.equal(shouldApplyWhopSyncToCreatedUser("user_new", ["user_other", "user_new"]), true);
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
  assert.match(premium.whereSql, /tier IN \('premium', 'pro', 'elite'\)/);

  const community = buildAdminUserFilterSql({ tier: "community" });
  assert.match(community.whereSql, /membership_kind = 'community'/);

  const admin = buildAdminUserFilterSql({ role: "admin" });
  assert.match(admin.whereSql, /role = 'admin'/);

  const combined = buildAdminUserFilterSql({ tier: "free", role: "member" });
  assert.match(combined.whereSql, /COALESCE\(tier, 'free'\) NOT IN \('premium', 'pro', 'elite', 'community'\)/);
  assert.match(combined.whereSql, /<> 'admin'/);

  const accessPremium = buildAdminUserFilterSql({ access: "premium" });
  assert.match(accessPremium.whereSql, /tier IN \('premium', 'pro', 'elite'\)/);
  assert.match(accessPremium.whereSql, /<> 'admin'/);

  const accessFree = buildAdminUserFilterSql({ access: "free" });
  assert.match(accessFree.whereSql, /COALESCE\(tier, 'free'\) NOT IN \('premium', 'pro', 'elite', 'community'\)/);
  assert.match(accessFree.whereSql, /NOT IN \('community', 'premium'\)/);
});

// Regression (round 394, DISCOVERY-lane). `parseTier` (lib/tiers.ts) has "always coerced"
// the legacy pre-rename tier aliases "pro"/"elite" to "premium" for every consumer that grants
// real behavior off a user's tier — tier-cache.ts's `resolveUserTier` (real desk access),
// `classifyAdminUserAccess` (this same admin dashboard's own row badge), and
// `isPaidTierForReconcileDowngradeCheck` (membership.ts's Whop reconcile cron). Pre-fix,
// `buildAdminUserFilterSql` compared the RAW literal "tier = 'premium'" only, so a row whose
// `tier` column still carries "pro" or "elite" (e.g. a legacy Postgres mirror row never resynced
// since `upsertAdminUserRow`'s callers started normalizing with `parseTier` on write) was badged
// "Premium" in the unfiltered admin list yet INVISIBLE to the "access=premium"/"tier=premium"
// filters — the exact "badge disagrees with filter" shape the community dual-signal fix above
// (#7520) already fixed once, one alias layer earlier.
test("buildAdminUserFilterSql premium clauses also match legacy 'pro'/'elite' tier aliases, matching classifyAdminUserAccess/parseTier", () => {
  const accessPremium = buildAdminUserFilterSql({ access: "premium" });
  assert.match(accessPremium.whereSql, /tier IN \('premium', 'pro', 'elite'\)/);

  const tierPremium = buildAdminUserFilterSql({ tier: "premium" });
  assert.match(tierPremium.whereSql, /tier IN \('premium', 'pro', 'elite'\)/);

  // The community clauses must exclude the SAME alias set, not just literal 'premium' — a
  // tier='pro' row with membership_kind='community' is "premium" per classifyAdminUserAccess's
  // priority order (tier wins), so it must not also match the community filter.
  const accessCommunity = buildAdminUserFilterSql({ access: "community" });
  assert.match(accessCommunity.whereSql, /COALESCE\(tier, 'free'\) NOT IN \('premium', 'pro', 'elite'\)/);

  const tierCommunity = buildAdminUserFilterSql({ tier: "community" });
  assert.match(tierCommunity.whereSql, /COALESCE\(tier, 'free'\) NOT IN \('premium', 'pro', 'elite'\)/);
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
  assert.match(accessCommunity.whereSql, /COALESCE\(tier, 'free'\) NOT IN \('premium', 'pro', 'elite'\)/);

  const tierCommunity = buildAdminUserFilterSql({ tier: "community" });
  assert.match(tierCommunity.whereSql, /membership_kind = 'community'/);
  assert.match(tierCommunity.whereSql, /COALESCE\(tier, 'free'\) NOT IN \('premium', 'pro', 'elite'\)/);
});

test(
  "buildAdminUserFilterSql community clauses must also recognize tier='community' directly, " +
    "not only membership_kind='community' — the admin Edit/Create User modal path",
  () => {
    // admin-user-access.ts's classifyAdminUserAccess documents this exact path: "Community can
    // be signaled either by the Whop membershipKind (the normal webhook path, where `tier`
    // metadata itself often stays 'free') or by `tier` directly (an admin manually setting
    // tier=community via the Edit/Create User modal, which never touches membershipKind)" —
    // and PATCH /api/admin/users/[id] confirms it: when "tier" is in the request body it writes
    // ONLY metaUpdates.tier, never membership_kind, so a user an admin promotes straight to
    // tier='community' lands in Postgres with membership_kind=null.
    //
    // classifyAdminUserAccess badges that row "Community" (tier === 'community' alone is
    // sufficient there) — so the admin dashboard's unfiltered list and its "access=community"/
    // "tier=community" filters must agree on which rows are community. Pre-fix, both clauses
    // required membership_kind = 'community' and never referenced the tier column at all, so
    // this exact row was invisible to both filters despite showing a "Community" badge in the
    // default (unfiltered) list.
    const accessCommunity = buildAdminUserFilterSql({ access: "community" });
    assert.match(accessCommunity.whereSql, /tier = 'community'/);

    const tierCommunity = buildAdminUserFilterSql({ tier: "community" });
    assert.match(tierCommunity.whereSql, /tier = 'community'/);
  }
);

test(
  "computeAdminUserListStats must count a tier='community'-only row (membership_kind null) " +
    "in the community bucket, matching classifyAdminUserAccess's badge",
  () => {
    const rows = [
      { email: "admin-set-community@gmail.com", tier: "community", role: null, membership_kind: null },
    ];
    const stats = computeAdminUserListStats(rows, []);
    assert.deepEqual(stats, { total: 1, premium: 0, admins: 0, community: 1, free: 0 });
  }
);

// Regression (round 394, DISCOVERY-lane) — see buildAdminUserFilterSql's matching fix above for
// the full root-cause writeup. A row whose `tier` column still carries a legacy "pro"/"elite"
// alias (pre-dating the `parseTier`-on-write normalization every current write path applies) is
// badged "Premium" by classifyAdminUserAccess (which normalizes); this stats bucket must agree.
test(
  "computeAdminUserListStats counts a legacy tier='pro'/'elite' row as Premium, matching classifyAdminUserAccess/parseTier",
  () => {
    const rows = [
      { email: "legacy.pro@gmail.com", tier: "pro", role: null, membership_kind: null },
      { email: "legacy.elite@gmail.com", tier: "elite", role: null, membership_kind: null },
    ];
    const stats = computeAdminUserListStats(rows, []);
    assert.deepEqual(stats, { total: 2, premium: 2, admins: 0, community: 0, free: 0 });
  }
);

// A legacy-aliased tier that ALSO carries membership_kind='community' must still resolve to
// Premium, not double-count into Community — tier wins over membership_kind in
// classifyAdminUserAccess's own priority order, alias or not.
test(
  "computeAdminUserListStats: a legacy 'pro'/'elite' tier with membership_kind='community' still counts as Premium, not Community",
  () => {
    const rows = [
      { email: "legacy.pro.community@gmail.com", tier: "pro", role: null, membership_kind: "community" },
    ];
    const stats = computeAdminUserListStats(rows, []);
    assert.deepEqual(stats, { total: 1, premium: 1, admins: 0, community: 0, free: 0 });
  }
);

// Regression (round 405, DISCOVERY-lane). `AdminUserStatsRow.tier` is typed `string | null`, and
// `classifyAdminUserAccess`/`parseTier` both normalize a null (or any other unrecognized) tier
// value to "free" — the row's own badge in the unfiltered admin list reads "Free". Pre-fix, the
// free bucket here compared the raw literal (`row.tier === "free"`), which is false for a null
// tier, so the row counted toward `total` but toward NONE of premium/community/free — silently
// vanishing from every stat tile despite being badged "Free", not merely a `tier: 'free'` row
// that happened to also look like something else. Same bug shape, one bucket over, as the
// legacy 'pro'/'elite' premium-bucket fix and the tier='community'-only community-bucket fix
// above — just reached via a null tier rather than a legacy alias string.
test(
  "computeAdminUserListStats counts a null-tier row as Free, matching classifyAdminUserAccess/parseTier (not silently dropped from every bucket)",
  () => {
    const rows = [
      { email: "legacy.null.tier@gmail.com", tier: null, role: null, membership_kind: null },
    ];
    const stats = computeAdminUserListStats(rows, []);
    assert.deepEqual(stats, { total: 1, premium: 0, admins: 0, community: 0, free: 1 });
  }
);

// Same null-tier gap, but with a membership_kind='community' signal present — must still land
// in Community (the dual-signal check already handled this via membership_kind, independent of
// the literal tier comparison), not accidentally double-count into the now-fixed Free bucket.
test(
  "computeAdminUserListStats: a null-tier row with membership_kind='community' still counts as Community, not Free",
  () => {
    const rows = [
      { email: "legacy.null.tier.community@gmail.com", tier: null, role: null, membership_kind: "community" },
    ];
    const stats = computeAdminUserListStats(rows, []);
    assert.deepEqual(stats, { total: 1, premium: 0, admins: 0, community: 1, free: 0 });
  }
);

// Same literal-vs-normalized gap in the SQL filter layer: pre-fix, `tier = 'free'` is NULL/false
// in Postgres for a row whose tier column is actually NULL, so "show free" and the Free stat
// tile disagreed with the row's own "Free" badge in the unfiltered list — the SQL-side sibling
// of the two stats-bucket regressions above.
test(
  "buildAdminUserFilterSql free clauses match a NULL tier column too (COALESCE, not a raw literal comparison)",
  () => {
    const accessFree = buildAdminUserFilterSql({ access: "free" });
    assert.match(accessFree.whereSql, /COALESCE\(tier, 'free'\) NOT IN \('premium', 'pro', 'elite', 'community'\)/);
    assert.doesNotMatch(accessFree.whereSql, /^tier = 'free'/);

    const tierFree = buildAdminUserFilterSql({ tier: "free" });
    assert.match(tierFree.whereSql, /COALESCE\(tier, 'free'\) NOT IN \('premium', 'pro', 'elite', 'community'\)/);
  }
);
