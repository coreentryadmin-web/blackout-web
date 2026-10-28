import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { logAdminAction } from "@/lib/admin-audit";
import {
  getAdminUserListStats,
  listClerkUserIdsByDbFilters,
  shouldUseDbAdminUserList,
} from "@/lib/admin-users";
import { isAdminEmail } from "@/lib/admin-emails";
import { classifyAdminUserAccess } from "@/lib/admin-user-access";
import type { BillingKind } from "@/lib/whop";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

type ClerkUser = Awaited<
  ReturnType<Awaited<ReturnType<typeof clerkClient>>["users"]["getUser"]>
>;

function mapClerkUser(user: ClerkUser) {
  const meta = (user.publicMetadata ?? {}) as Record<string, unknown>;
  const email =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? null;
  const membershipKind = String(meta.membership_kind ?? "") as BillingKind | "";
  const tier = String(meta.tier ?? "free");
  const role = String(meta.role ?? "");
  const access = classifyAdminUserAccess({
    tier,
    membershipKind:
      membershipKind === "premium" || membershipKind === "community" || membershipKind === "free"
        ? membershipKind
        : null,
    role,
    emailAdmin: isAdminEmail(email),
  });

  return {
    id: user.id,
    email,
    firstName: user.firstName,
    lastName: user.lastName,
    imageUrl: user.imageUrl,
    tier,
    membershipKind:
      membershipKind === "premium" || membershipKind === "community" || membershipKind === "free"
        ? membershipKind
        : null,
    role,
    whopUserId: meta.whop_user_id ?? null,
    whopMembershipId: meta.whop_membership_id ?? null,
    createdAt: user.createdAt,
    lastSignInAt: user.lastSignInAt,
    banned: user.banned,
    accessLabel: access.accessLabel,
    deskAccess: access.deskAccess,
    accessSummary: access.accessSummary,
  };
}

export async function GET(req: NextRequest) {
  const { actor, denied } = await resolveAdminApi();
  if (denied) return denied;

  void logAdminAction({
    actorUserId: actor?.userId,
    actorEmail: actor?.email,
    action: "admin_users_list",
    detail: { path: "admin/users" },
  });

  const url = new URL(req.url);
  const query = url.searchParams.get("q")?.trim() || "";
  // The `|| "1"`/`|| "50"` only guards an EMPTY string — a non-numeric one (e.g. `page=abc`)
  // is still truthy, so it skips that fallback, then `Number("abc")` = NaN survives
  // Math.max/Math.min (NaN is neither < nor > anything) and reaches `offset = (NaN-1)*limit`
  // = NaN with no try/catch anywhere in this handler, throwing uncaught inside either the raw
  // Postgres OFFSET bind or the Clerk Backend API call. The second `|| 1`/`|| 50` after
  // Number(...) catches it (NaN is falsy), so a malformed page/limit degrades to the default
  // instead of a framework-level 500.
  // `Math.trunc(...)` guards the OTHER malformed shape this didn't cover: a fractional value
  // (`page=1.5`/`limit=50.7`) is finite, so it survives Number(...) and both Math.max/Math.min
  // unchanged, then reaches `LIMIT $N OFFSET $N` in `listClerkUserIdsByDbFilters`'s raw SQL as
  // a non-integer bound param — Postgres' bigint input parser rejects a decimal point outright
  // (`invalid input syntax for type bigint`), so this degraded the SAME way the NaN case did
  // before the fix above: an uncaught 500 instead of rounding to the nearest page/limit.
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page") || "1") || 1));
  const limit = Math.min(
    100,
    Math.max(1, Math.trunc(Number(url.searchParams.get("limit") || "50") || 50)),
  );
  const tierFilter = url.searchParams.get("tier") || "";
  const roleFilter = url.searchParams.get("role") || "";
  const accessFilter = url.searchParams.get("access") || "";
  const offset = (page - 1) * limit;

  const filters = { tier: tierFilter, role: roleFilter, query, access: accessFilter };
  const stats = await getAdminUserListStats();
  const client = await clerkClient();

  if (shouldUseDbAdminUserList(filters)) {
    const { ids, total } = await listClerkUserIdsByDbFilters(filters, limit, offset);

    if (total === 0 || ids.length === 0) {
      return NextResponse.json({
        users: [],
        total: 0,
        page,
        limit,
        pages: 0,
        stats,
        filterNote: null,
      }, { headers: NO_STORE_HEADERS });
    }

    const { data } = await client.users.getUserList({ userId: ids, limit: ids.length });
    const byId = new Map(data.map((u) => [u.id, u]));
    const users = ids
      .map((id) => byId.get(id))
      .filter((u): u is ClerkUser => Boolean(u))
      .map(mapClerkUser);

    return NextResponse.json({
      users,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      stats,
      filterNote: null,
    }, { headers: NO_STORE_HEADERS });
  }

  const params: Parameters<typeof client.users.getUserList>[0] = {
    limit,
    offset,
    orderBy: "-created_at",
  };

  if (query) {
    if (query.includes("@")) {
      params.emailAddress = [query];
    } else {
      params.query = query;
    }
  }

  const { data, totalCount } = await client.users.getUserList(params);
  const users = data.map(mapClerkUser);

  return NextResponse.json({
    users,
    total: totalCount,
    page,
    limit,
    pages: Math.ceil(totalCount / limit),
    stats,
    filterNote: null,
  }, { headers: NO_STORE_HEADERS });
}
