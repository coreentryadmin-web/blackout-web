import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { auth, currentUser } from "@clerk/nextjs/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-04-10" });

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tier } = await req.json();
  const priceId =
    tier === "elite"
      ? process.env.STRIPE_ELITE_PRICE_ID!
      : process.env.STRIPE_PRO_PRICE_ID!;

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${req.nextUrl.origin}/dashboard?upgraded=true`,
    cancel_url: `${req.nextUrl.origin}/#pricing`,
    metadata: { clerk_user_id: userId, price_id: priceId },
  });

  return NextResponse.json({ url: session.url });
}
