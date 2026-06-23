import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireDatabaseInProduction } from "@/lib/db";
import { fetchUserJournal, saveUserJournalEntry } from "@/lib/journal/journal-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET → all journal entries for the signed-in user, keyed by open_play_id.
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;
  // Journaling is per-user; a cron caller has no user to scope to.
  if (!auth.userId) {
    return NextResponse.json({ error: "User session required" }, { status: 401 });
  }
  try {
    const entries = await fetchUserJournal(auth.userId);
    return NextResponse.json({ entries });
  } catch (error) {
    console.error("[market/spx/journal GET]", error);
    return NextResponse.json({ entries: {}, error: "Failed to load journal" }, { status: 502 });
  }
}

// POST { open_play_id, note, tags } → upsert (empty clears the entry).
export async function POST(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;
  if (!auth.userId) {
    return NextResponse.json({ error: "User session required" }, { status: 401 });
  }
  const dbGuard = requireDatabaseInProduction();
  if (dbGuard) return dbGuard;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      open_play_id?: unknown;
      note?: unknown;
      tags?: unknown;
    };
    const openPlayId = Number(body.open_play_id);
    if (!Number.isFinite(openPlayId) || openPlayId <= 0) {
      return NextResponse.json({ error: "Invalid open_play_id" }, { status: 400 });
    }
    const note = typeof body.note === "string" ? body.note : "";
    const tags = Array.isArray(body.tags)
      ? (body.tags as unknown[]).map(String)
      : typeof body.tags === "string"
        ? body.tags
        : "";
    const entry = await saveUserJournalEntry(auth.userId, openPlayId, note, tags);
    return NextResponse.json({ entry });
  } catch (error) {
    console.error("[market/spx/journal POST]", error);
    return NextResponse.json({ error: "Failed to save journal entry" }, { status: 502 });
  }
}
