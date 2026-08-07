// The signed-in member's affiliate standing, read live from Whop's native affiliate program.
//
// This replaced a first-party `referrals` table. Whop already runs the program (on by default at
// 30%), owns attribution at its own checkout, computes commission, holds the funds and pays out —
// verified live on the production company, which already had affiliates and referred conversions
// before we surfaced anything. See src/lib/whop-affiliates.ts for the full rationale.
import { NextResponse } from "next/server";
import { requireTierApi } from "@/lib/market-api-auth";
import { dbConfigured, dbQuery } from "@/lib/db";
import {
  findAffiliateForWhopUser,
  WHOP_AFFILIATE_DASHBOARD_URL,
  type WhopAffiliate,
} from "@/lib/whop-affiliates";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clerk user -> Whop user id. `users.whop_user_id` is maintained by the membership sync and is the
 *  same id space as the affiliate record's `user.id`, which is what lets us resolve a member who
 *  enrolled through Whop's UI without us storing anything new. */
async function whopUserIdFor(clerkUserId: string): Promise<string | null> {
  if (!dbConfigured()) return null;
  try {
    const res = await dbQuery<{ whop_user_id: string | null }>(
      `SELECT whop_user_id FROM users WHERE clerk_user_id = $1 LIMIT 1`,
      [clerkUserId]
    );
    return res.rows[0]?.whop_user_id ?? null;
  } catch (err) {
    console.warn("[referrals/me] whop_user_id lookup failed", err);
    return null;
  }
}

function wire(a: WhopAffiliate) {
  // Money/percent fields are PRE-FORMATTED display strings from Whop ("$0.00", "0.0%") — pass them
  // through verbatim rather than parsing, so we can never disagree with Whop's own numbers.
  return {
    id: a.id,
    status: a.status,
    referrals: a.total_referrals_count,
    earnings: a.total_referral_earnings_usd,
    activeMembers: a.active_members_count,
    retentionRate: a.customer_retention_rate,
    mrr: a.monthly_recurring_revenue_usd,
    totalRevenue: a.total_revenue_usd,
    username: a.user?.username ?? null,
  };
}

export async function GET() {
  const authResult = await requireTierApi("free");
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const dashboardUrl = WHOP_AFFILIATE_DASHBOARD_URL;

  let affiliate = null;
  let degraded = false;
  try {
    const whopUserId = await whopUserIdFor(userId);
    const found = await findAffiliateForWhopUser(whopUserId);
    affiliate = found ? wire(found) : null;
  } catch (err) {
    // Whop unreachable / misconfigured: report DEGRADED rather than rendering "0 referrals, $0",
    // which a member would read as "my referrals vanished" instead of "we can't reach Whop".
    console.warn("[referrals/me] whop affiliate lookup failed", err);
    degraded = true;
  }

  return NextResponse.json(
    { enrolled: Boolean(affiliate), affiliate, dashboardUrl, degraded },
    { headers: NO_STORE_HEADERS }
  );
}
