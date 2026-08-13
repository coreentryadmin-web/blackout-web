import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { getLargoSessionMessages, largoConfigured } from "@/lib/largo-terminal";
import { fetchLargoSessionMetadata, updateLargoSessionMetadata } from "@/lib/largo/largo-store";
import { normalizeWatchlist } from "@/lib/largo/session-metadata";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

/** Load persisted Largo conversation for the signed-in user. */
export async function GET(req: NextRequest) {
  const authResult = await requireTierApi("premium");
  if (authResult instanceof Response) return authResult;

  const locked = await requireToolApi("largo");
  if (locked) return locked;

  if (!largoConfigured()) {
    return NextResponse.json({ error: "Largo not configured" }, { status: 503 });
  }

  const sessionId = req.nextUrl.searchParams.get("session_id")?.trim() ?? "";
  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  try {
    const payload = await getLargoSessionMessages(sessionId, authResult.userId);
    const metadata = await fetchLargoSessionMetadata(sessionId, authResult.userId);
    return NextResponse.json({ ...payload, metadata }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[market/largo/session]", error);
    return NextResponse.json({ error: "Failed to load session" }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireTierApi("premium");
  if (auth instanceof Response) return auth;
  const locked = await requireToolApi("largo");
  if (locked) return locked;
  if (!largoConfigured()) {
    return NextResponse.json({ error: "Largo not configured" }, { status: 503 });
  }

  let body: {
    session_id?: string;
    watchlist?: string[];
    watchlist_add?: string;
    morning_brief?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sessionId = String(body.session_id ?? "").trim();
  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  try {
    const prev = await fetchLargoSessionMetadata(sessionId, auth.userId);
    const patch: Parameters<typeof updateLargoSessionMetadata>[2] = {};
    if (body.morning_brief != null) patch.morning_brief = Boolean(body.morning_brief);
    if (Array.isArray(body.watchlist)) patch.watchlist = normalizeWatchlist(body.watchlist);
    if (body.watchlist_add) {
      const add = normalizeWatchlist([body.watchlist_add]);
      patch.watchlist = normalizeWatchlist([...(prev.watchlist ?? []), ...add]);
    }
    const metadata = await updateLargoSessionMetadata(sessionId, auth.userId, patch);
    return NextResponse.json({ session_id: sessionId, metadata }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[market/largo/session PATCH]", error);
    return NextResponse.json({ error: "Failed to update session" }, { status: 502 });
  }
}
