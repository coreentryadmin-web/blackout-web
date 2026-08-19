import { NextRequest, NextResponse } from "next/server";
import { requireTierApi } from "@/lib/market-api-auth";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { largoSlashCommandByToken } from "@/lib/largo/slash-commands";
import { buildSlashPromptsForDesk } from "@/lib/largo/slash-prompts";

export const dynamic = "force-dynamic";

/** Live, desk-scoped ask prompts for Largo slash commands — no LLM, cache-reader reads only. */
export async function GET(req: NextRequest) {
  const auth = await requireTierApi("premium");
  if (auth instanceof Response) return auth;

  const desk = (req.nextUrl.searchParams.get("desk") ?? "").trim().toLowerCase();
  if (!desk) {
    return NextResponse.json({ error: "desk is required" }, { status: 400 });
  }

  const cmd = largoSlashCommandByToken(desk);
  const payload = await buildSlashPromptsForDesk(desk, cmd ?? null);

  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}
