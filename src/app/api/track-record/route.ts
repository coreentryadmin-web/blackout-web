import { NextRequest, NextResponse } from "next/server";
import { buildTrackRecordPagePayload } from "@/lib/track-record-page";
import { requireAdminApi } from "@/lib/admin-access";
import { getClientIp, checkIpRateLimit, rateLimitHeaders } from "@/lib/ip-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// Admin-only: full track-record page payload for /admin/track-record.
const RATE_LIMIT = 60;
const RATE_WINDOW_SECS = 60;

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const ip = getClientIp(req);
  const rl = await checkIpRateLimit(ip, "track-record", RATE_LIMIT, RATE_WINDOW_SECS);
  const rlHeaders = rateLimitHeaders(rl);

  if (!rl.ok) {
    return NextResponse.json(
      { available: false },
      { status: 429, headers: { ...NO_STORE, ...rlHeaders } }
    );
  }

  const payload = await buildTrackRecordPagePayload();
  if (payload.available === false) {
    return NextResponse.json({ available: false }, { headers: { ...NO_STORE, ...rlHeaders } });
  }
  return NextResponse.json(payload, { headers: { ...NO_STORE, ...rlHeaders } });
}
