import { NextResponse } from "next/server";
import { fetchRecentSpxSignals } from "@/lib/providers/spx-signal-log";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));
    const rows = await fetchRecentSpxSignals(limit);
    return NextResponse.json({ rows });
  } catch (error) {
    console.error("[market/spx/signals]", error);
    return NextResponse.json({ rows: [], error: "Failed to load signals" }, { status: 502 });
  }
}
