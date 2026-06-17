import { NextResponse } from "next/server";
import { polygonConfigured, uwConfigured, finnhubConfigured } from "@/lib/providers/config";
import { dbConfigured } from "@/lib/db";

export async function GET() {
  return NextResponse.json({
    ok: polygonConfigured() || uwConfigured() || dbConfigured(),
    polygon: polygonConfigured(),
    unusual_whales: uwConfigured(),
    finnhub: finnhubConfigured(),
    postgres: dbConfigured(),
  });
}