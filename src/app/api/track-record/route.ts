import { NextResponse } from "next/server";
import { buildTrackRecordPagePayload } from "@/lib/track-record-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET() {
  const payload = await buildTrackRecordPagePayload();
  if (payload.available === false) {
    return NextResponse.json({ available: false }, { headers: NO_STORE });
  }
  return NextResponse.json(payload, { headers: NO_STORE });
}
