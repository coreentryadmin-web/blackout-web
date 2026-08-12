import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { postDiscordWebhook } from "@/lib/discord-post";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

/** One-click share of a Largo verdict + levels to Discord. */
export async function POST(req: NextRequest) {
  const auth = await requireTierApi("premium");
  if (auth instanceof Response) return auth;
  const locked = await requireToolApi("largo");
  if (locked) return locked;

  let body: { answer?: string; headline?: string | null; ticker?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const answer = String(body.answer ?? "").trim();
  if (!answer || answer.length > 4000) {
    return NextResponse.json({ error: "answer required (max 4000 chars)" }, { status: 400 });
  }

  const ticker = body.ticker ? String(body.ticker).trim().toUpperCase() : null;
  const headline = body.headline ? String(body.headline).trim().slice(0, 200) : null;
  const excerpt = answer.slice(0, 1800);

  const title = headline ?? (ticker ? `Largo · ${ticker}` : "Largo desk read");
  const webhook =
    process.env.DISCORD_LARGO_SHARE_WEBHOOK_URL?.trim() ||
    process.env.DISCORD_ALERT_WEBHOOK_URL?.trim();
  if (!webhook) {
    return NextResponse.json({ error: "Share unavailable" }, { status: 503 });
  }

  await postDiscordWebhook(
    webhook,
    {
      embeds: [
        {
          title,
          description: excerpt,
          color: 0x22d3ee,
          timestamp: new Date().toISOString(),
          footer: { text: "BlackOut Largo" },
        },
      ],
    },
    "largo-share"
  );

  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}
