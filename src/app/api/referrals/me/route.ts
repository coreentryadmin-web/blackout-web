// Current user's referral link + stats — powers the /account "Refer a friend" panel.
import { NextResponse } from "next/server";
import { requireTierApi } from "@/lib/market-api-auth";
import { getReferralStatsForUser } from "@/lib/referrals";
import { SITE } from "@/lib/site";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const authResult = await requireTierApi("free");
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const stats = await getReferralStatsForUser(userId);
  const link = `${SITE.url}/?ref=${encodeURIComponent(userId)}`;

  return NextResponse.json({ link, stats }, { headers: NO_STORE_HEADERS });
}
