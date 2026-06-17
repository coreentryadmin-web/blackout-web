import { NextRequest, NextResponse } from "next/server";
import Whop from "@whop/sdk";
import { syncWhopMembershipForEmail } from "@/lib/membership";

function getWhopWebhookClient() {
  return new Whop({
    apiKey: process.env.WHOP_API_KEY,
    webhookKey: process.env.WHOP_WEBHOOK_SECRET ?? null,
  });
}

export async function POST(req: NextRequest) {
  const whop = getWhopWebhookClient();
  const body = await req.text();
  const headers = Object.fromEntries(req.headers);

  let event;
  try {
    event = whop.webhooks.unwrap(body, { headers });
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  try {
    if (
      event.type === "membership.activated" ||
      event.type === "membership.deactivated"
    ) {
      const email = event.data.user?.email;
      if (email) await syncWhopMembershipForEmail(email);
    }
  } catch (error) {
    console.error("[whop webhook]", event.type, error);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
