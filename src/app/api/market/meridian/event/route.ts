import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { requireToolApiForDeskCaller } from "@/lib/tool-access-server";
import { macroEventsOnDateLive } from "@/lib/providers/macro-events";
import { preEarningsPackForLargo } from "@/lib/largo/pre-earnings-pack";
import {
  buildMeridianMacroBrief,
  buildMeridianOpexDetail,
} from "@/lib/meridian/meridian-event-brief";
import { parseMeridianEventId } from "@/features/meridian/lib/meridian-timeline";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizePremiumDeskApi(req);
  if (auth instanceof Response) return auth;
  const gate = await requireToolApiForDeskCaller(auth, "meridian");
  if (gate) return gate;

  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const parsed = parseMeridianEventId(id);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid event id" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    if (parsed.kind === "earnings") {
      const ticker = parsed.ticker;
      if (!ticker) {
        return NextResponse.json({ error: "Missing ticker" }, { status: 400, headers: NO_STORE_HEADERS });
      }
      const pack = await preEarningsPackForLargo(ticker, parsed.date);
      if (!pack) {
        return NextResponse.json({ error: "Earnings pack unavailable" }, { status: 404, headers: NO_STORE_HEADERS });
      }
      return NextResponse.json(roundFloats({ kind: "earnings", pack }), { headers: NO_STORE_HEADERS });
    }

    if (parsed.kind === "opex") {
      const detail = await buildMeridianOpexDetail(parsed.date);
      return NextResponse.json(detail, { headers: NO_STORE_HEADERS });
    }

    const rows = await macroEventsOnDateLive(parsed.date);
    const slug = parsed.slug?.replace(/-/g, " ") ?? "";
    const match =
      rows.find((r) => r.event.toLowerCase() === slug.toLowerCase()) ??
      rows.find((r) => slug && r.event.toLowerCase().includes(slug.toLowerCase())) ??
      rows[0];
    if (!match) {
      return NextResponse.json({ error: "Macro event not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }

    const brief = await buildMeridianMacroBrief({
      event: match.event,
      date: parsed.date,
      time: match.time?.trim() || null,
      impact: match.impact === "high" ? "high" : match.impact === "medium" ? "medium" : "low",
    });
    return NextResponse.json(brief, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[market/meridian/event]", error);
    return NextResponse.json({ error: "Event detail failed" }, { status: 502, headers: NO_STORE_HEADERS });
  }
}
