import { NextResponse } from "next/server";
import { polygonConfigured, uwConfigured, finnhubConfigured } from "@/lib/providers/config";

export async function GET() {
  return NextResponse.json({
    ok: polygonConfigured() || uwConfigured(),
    polygon: polygonConfigured(),
    unusual_whales: uwConfigured(),
    finnhub: finnhubConfigured(),
  });
}
