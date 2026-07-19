import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { logAdminAction } from "@/lib/admin-audit";
import { isCognitoAuth } from "@/lib/auth-provider";

export const dynamic = "force-dynamic";

function mapClerkUser(user: Awaited<ReturnType<Awaited<ReturnType<typeof clerkClient>>["users"]["getUser"]>>) {
  const meta = (user.publicMetadata ?? {}) as Record<string, unknown>;
  const primaryEmail =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? null;

  return {
    id: user.id,
    email: primaryEmail,
    firstName: user.firstName,
    lastName: user.lastName,
    imageUrl: user.imageUrl,
    tier: String(meta.tier ?? "free"),
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
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || "20")));
  const tierFilter = url.searchParams.get("tier") || "";
  const roleFilter = url.searchParams.get("role") || "";
  const offset = (page - 1) * limit;

  const client = await clerkClient();

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

  const users = data
    .map(mapClerkUser)
    .filter((u) => {
      if (tierFilter && u.tier !== tierFilter) return false;
      if (roleFilter === "admin" && u.role !== "admin") return false;
      if (roleFilter === "member" && u.role === "admin") return false;
      return true;
    });

  return NextResponse.json({
    users,
    total: totalCount,
    page,
    limit,
    pages: Math.ceil(totalCount / limit),
    filterNote:
      tierFilter || roleFilter
        ? "Tier and role filters apply to the current Clerk page only — use email search for exact lookup."
        : null,
  });
}
