import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { logAdminAction } from "@/lib/admin-audit";
import { isCognitoAuth } from "@/lib/auth-provider";

export const dynamic = "force-dynamic";

const DEFAULT_TTL_SEC = 900;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { actor, denied } = await resolveAdminApi();
  if (denied) return denied;

  if (isCognitoAuth()) {
    return NextResponse.json({ error: "User management requires Clerk auth." }, { status: 501 });
  }

  const { id } = await params;

  const client = await clerkClient();
  let email: string | null = null;
  try {
    const user = await client.users.getUser(id);
    email =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? null;
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    throw err;
  }

  const token = await client.signInTokens.createSignInToken({
    userId: id,
    expiresInSeconds: DEFAULT_TTL_SEC,
  });

  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
  const url = `${base}/sign-in?__clerk_ticket=${encodeURIComponent(token.token)}`;

  void logAdminAction({
    actorUserId: actor?.userId,
    actorEmail: actor?.email,
    action: "admin_user_sign_in_link",
    detail: { targetUserId: id, targetEmail: email, expiresInSeconds: DEFAULT_TTL_SEC },
  });

  return NextResponse.json({
    url,
    expiresInSeconds: DEFAULT_TTL_SEC,
    userId: id,
    email,
  });
}
