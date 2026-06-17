import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { clerkClient } from "@clerk/nextjs/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-04-10" });

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed" || event.type === "customer.subscription.updated") {
    const session = event.data.object as Stripe.Checkout.Session | Stripe.Subscription;
    const clerkUserId = (session.metadata as Record<string, string> | null)?.clerk_user_id;
    if (!clerkUserId) return NextResponse.json({ ok: true });

    // Determine tier from price ID
    const priceId =
      event.type === "checkout.session.completed"
        ? (session as Stripe.Checkout.Session).metadata?.price_id
        : ((session as Stripe.Subscription).items?.data[0]?.price?.id ?? "");

    const tier =
      priceId === process.env.STRIPE_ELITE_PRICE_ID
        ? "elite"
        : priceId === process.env.STRIPE_PRO_PRICE_ID
        ? "pro"
        : "free";

    await (await clerkClient()).users.updateUserMetadata(clerkUserId, {
      publicMetadata: { tier },
    });
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    const clerkUserId = sub.metadata?.clerk_user_id;
    if (clerkUserId) {
      await (await clerkClient()).users.updateUserMetadata(clerkUserId, {
        publicMetadata: { tier: "free" },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
