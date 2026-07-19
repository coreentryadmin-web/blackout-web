import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { logAdminAction } from "@/lib/admin-audit";
import {
  getAdminUserListStats,
  listClerkUserIdsByDbFilters,
  shouldUseDbAdminUserList,
} from "@/lib/admin-users";
import { isCognitoAuth } from "@/lib/auth-provider";
import type { BillingKind } from "@/lib/whop";

export const dynamic = "force-dynamic";

type ClerkUser = Awaited<
  ReturnType<Awaited<ReturnType<typeof clerkClient>>["users"]["getUser"]>
>;

function mapClerkUser(user: ClerkUser) {
  const meta = (user.publicMetadata ?? {}) as Record<string, unknown>;
  const primaryEmail =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? null;
  const membershipKind = String(meta.membership_kind ?? "") as BillingKind | "";

  return {
    id: user.id,
    email: primaryEmail,
    firstName: user.firstName,
    lastName: user.lastName,
    imageUrl: user.imageUrl,
    tier: String(meta.tier ?? "free"),
    membershipKind:
      membershipKind === "premium" || membershipKind === "community" || membershipKind === "free"
        ? membershipKind
        : null,
    role: String(meta.role ?? ""),
    whopUserId: meta.whop_user_id ?? null,
    whopMembershipId: meta.whop_membership_id ?? null,
    createdAt: user.createdAt,
    lastSignInAt: user.lastSignInAt,
    banned: user.banned,
  };
}

export async function GET(req: NextRequest) {
  const { actor, denied } = await resolveAdminApi();
  if (denied) return denied;

  if (isCognitoAuth()) {
    return NextResponse.json(
      { error: "User management requires Clerk auth (production)." },
      { status: 501 }
    );
  }

  void logAdminAction({
    actorUserId: actor?.userId,
    actorEmail: actor?.email,
    action: "admin_users_list",
    detail: { path: "admin/users" },
  });

  const url = new URL(req.url);
  const query = url.searchParams.get("q")?.trim() || "";
  const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || "50")));
  const tierFilter = url.searchParams.get("tier") || "";
  const roleFilter = url.searchParams.get("role") || "";
  const offset = (page - 1) * limit;

  const filters = { tier: tierFilter, role: roleFilter, query };
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
      });
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
    });
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
  });
}
