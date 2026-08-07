// Records a referral at signup — called once, client-side, right after a new
// user completes sign-up (mirrors the existing sign_up GA4/X-pixel trigger in
// Ga4Attribution.tsx). Auth'd via Clerk so referredUserId can never be spoofed
// by the client; only the referrer's code is client-supplied.
import { NextResponse } from "next/server";
import { requireTierApi } from "@/lib/market-api-auth";
import { attributeReferralSignup } from "@/lib/referrals";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authResult = await requireTierApi("free");
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  let body: { referrerUserId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const referrerUserId = typeof body.referrerUserId === "string" ? body.referrerUserId.trim() : "";
  if (!referrerUserId) {
    return NextResponse.json({ error: "referrerUserId required" }, { status: 400 });
  }

  const result = await attributeReferralSignup({
    referrerUserId,
    referredUserId: userId,
  });

  return NextResponse.json(result, { headers: NO_STORE_HEADERS });
}
