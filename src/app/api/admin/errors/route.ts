import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchRecentErrorEvents } from "@/lib/error-sink";
import { recordAdminRouteError } from "@/lib/admin-route-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  // Admin-only: this route returns redacted error stacks/messages and must never
  // be reachable anonymously (mirror /api/admin/incidents).
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const events = await fetchRecentErrorEvents(Number.isFinite(limit) ? limit : 100);
    return NextResponse.json({ ok: true, events });
  } catch (error) {
    recordAdminRouteError("admin/errors", error);
    return NextResponse.json({ ok: false, error: "failed to load error events" }, { status: 500 });
  }
}
