import { NextResponse } from "next/server";
import { WHOP_CHECKOUT, WHOP_PREMIUM_CHECKOUT_OPTIONS } from "@/lib/whop-checkout";

export const dynamic = "force-dynamic";

/** Runtime Whop checkout URLs — ECS secrets apply without rebuild. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    checkout: WHOP_CHECKOUT,
    options: WHOP_PREMIUM_CHECKOUT_OPTIONS,
    configured: WHOP_PREMIUM_CHECKOUT_OPTIONS.length > 0 || Boolean(WHOP_CHECKOUT.store),
  });
}
