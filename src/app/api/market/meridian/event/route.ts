import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { serverCache } from "@/lib/server-cache";
import {
  loadMeridianEventResponse,
  MERIDIAN_EVENT_TTL_MS,
} from "@/lib/meridian/meridian-snapshot";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizePremiumDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("meridian");
  if (locked) return locked;

  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const detail = await serverCache(`meridian:event:v1:${id}`, MERIDIAN_EVENT_TTL_MS, () =>
      loadMeridianEventResponse(id)
    );
    if (!detail) {
      return NextResponse.json({ error: "Event not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json(detail, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[market/meridian/event]", error);
    return NextResponse.json({ error: "Event detail failed" }, { status: 502, headers: NO_STORE_HEADERS });
  }
}
