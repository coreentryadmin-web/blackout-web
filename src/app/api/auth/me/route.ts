import { NextResponse } from "next/server";
import { getUserProfile } from "@/lib/user-directory";
import { auth } from "@/lib/auth-server";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ signedIn: false, userId: null, email: null }, { headers: NO_STORE_HEADERS });
  }
  const profile = await getUserProfile(userId);
  return NextResponse.json({
    signedIn: true,
    userId,
    email: profile?.email ?? null,
    firstName: profile?.firstName ?? null,
    lastName: profile?.lastName ?? null,
    tier: profile?.tier ?? "free",
    role: profile?.role ?? null,
  }, { headers: NO_STORE_HEADERS });
}
