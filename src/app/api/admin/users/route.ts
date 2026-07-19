import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { logAdminAction } from "@/lib/admin-audit";
import { listClerkUserIdsByDbTier } from "@/lib/admin-users";
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

function applyRoleFilter(
  users: ReturnType<typeof mapClerkUser>[],
  roleFilter: string
): ReturnType<typeof mapClerkUser>[] {
  if (!roleFilter) return users;
  return users.filter((u) => {
    if (roleFilter === "admin") return u.role === "admin";
    if (roleFilter === "member") return u.role !== "admin";
    return true;
  });
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
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || "20")));
  const tierFilter = url.searchParams.get("tier") || "";
  const roleFilter = url.searchParams.get("role") || "";
  const offset = (page - 1) * limit;

  const client = await clerkClient();

  // Postgres tier index path (free/premium) — accurate paging when not searching.
  if (
    !query &&
    (tierFilter === "free" || tierFilter === "premium") &&
    !roleFilter
  ) {
    const { ids, total } = await listClerkUserIdsByDbTier(tierFilter, limit, offset);
    if (total > 0 && ids.length > 0) {
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
        filterNote: "Tier filter uses Postgres index (synced on billing sync and admin edits).",
      });
    }
    if (total === 0) {
      return NextResponse.json({
        users: [],
        total: 0,
        page,
        limit,
        pages: 0,
        filterNote: null,
      });
    }
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

  let users = data.map(mapClerkUser);

  if (tierFilter === "community") {
    users = users.filter((u) => u.membershipKind === "community");
  } else if (tierFilter === "free" || tierFilter === "premium") {
    users = users.filter((u) => u.tier === tierFilter);
  }

  users = applyRoleFilter(users, roleFilter);

  const filterNote =
    tierFilter === "community" || roleFilter
      ? tierFilter === "community"
        ? "Community filter applies to the current page — run billing sync to refresh membership_kind metadata."
        : "Role filter applies to the current Clerk page only — use email search for exact lookup."
      : tierFilter && tierFilter !== "free" && tierFilter !== "premium"
        ? null
        : tierFilter || roleFilter
          ? "Tier and role filters apply to the current Clerk page only — use email search for exact lookup."
          : null;

  return NextResponse.json({
    users,
    total: totalCount,
    page,
    limit,
    pages: Math.ceil(totalCount / limit),
    filterNote,
  });
}
