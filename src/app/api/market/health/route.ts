import { NextResponse } from "next/server";
import { buildMarketHealthSnapshot } from "@/lib/market-health";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  ensureDataSockets();
  const snapshot = await buildMarketHealthSnapshot();
  return NextResponse.json(snapshot, {
    status: snapshot.ok ? 200 : 503,
  });
}
