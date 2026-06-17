import { NextResponse } from "next/server";
import { fetchIndexSnapshot } from "@/lib/providers/polygon";
import { polygonConfigured } from "@/lib/providers/config";

export async function GET() {
  if (!polygonConfigured()) {
    return NextResponse.json({ error: "POLYGON_API_KEY not configured" }, { status: 503 });
  }

  try {
    const [spx, vix] = await Promise.all([
      fetchIndexSnapshot("I:SPX"),
      fetchIndexSnapshot("I:VIX"),
    ]);

    return NextResponse.json({
      source: "polygon",
      as_of: new Date().toISOString(),
      spx,
      vix,
    });
  } catch (error) {
    console.error("[market/indices]", error);
    return NextResponse.json({ error: "Index fetch failed" }, { status: 502 });
  }
}
