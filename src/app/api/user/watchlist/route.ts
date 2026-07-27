// GET  /api/user/watchlist   → { tickers: [...] } for the signed-in user
// PUT  /api/user/watchlist   → replace: { tickers: [...] } → { tickers: [...] } (normalized)
//
// Bound to the Clerk user so the same list appears on web + native + push
// routing. Mirrors the shape/pattern of the push subscribe route (auth-gate,
// lazy-table, no runtime edge — the pg driver needs node).

import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { dbConfigured } from "@/lib/db";
import { getUserWatchlist, setUserWatchlist } from "@/lib/user-watchlist-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET — return the caller's saved watchlist (empty array if none yet). */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!dbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const tickers = await getUserWatchlist(userId);
  // Cache-Control: no-store — a stale watchlist read is a real product bug
  // (the user just added a ticker; a cached response would hide it).
  return NextResponse.json(
    { tickers },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}

/** PUT — replace the caller's watchlist with the supplied array.
 *  Body: { tickers: string[] }. Response echoes the SERVER-normalized list so
 *  the client can update its local state to match (case-fold, dedupe, cap). */
export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!dbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: { tickers?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body?.tickers)) {
    return NextResponse.json({ error: "Missing tickers array" }, { status: 400 });
  }
  // setUserWatchlist calls `sanitize` internally, so the DB write and the
  // echoed response are the SAME normalized list — no drift between what
  // the server persisted and what the client thinks it persisted.
  const tickers = await setUserWatchlist(userId, body.tickers);
  return NextResponse.json(
    { tickers },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
