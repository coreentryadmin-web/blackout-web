import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { fetchUpcomingMacroEventsLive } from "@/lib/providers/macro-events";
import {
  loadMeridianEarningsTimeline,
  loadMeridianFdaTimeline,
} from "@/lib/meridian/meridian-timeline-server";
import { buildMeridianTimeline } from "@/features/meridian/lib/meridian-timeline";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 14;
const MAX_DAYS = 45;

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const rawDays = Number(req.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS);
  const daysAhead = Number.isFinite(rawDays)
    ? Math.min(MAX_DAYS, Math.max(1, Math.floor(rawDays)))
    : DEFAULT_DAYS;

  try {
    const today = todayEtYmd();
    const [macro, earningsRows, fdaRows] = await Promise.all([
      fetchUpcomingMacroEventsLive(daysAhead),
      loadMeridianEarningsTimeline(today, daysAhead),
      loadMeridianFdaTimeline(today, daysAhead),
    ]);

    const items = buildMeridianTimeline({
      todayYmd: today,
      daysAhead,
      macro: macro.map((m) => ({
        event: m.event,
        date: m.date ?? today,
        time: m.time,
        impact: m.impact,
        estimate: m.estimate ?? null,
      })),
      earnings: earningsRows,
      fda: fdaRows,
    });

    return NextResponse.json(
      roundFloats({
        as_of: new Date().toISOString(),
        days_ahead: daysAhead,
        items,
      }),
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[market/meridian/timeline]", error);
    return NextResponse.json({ error: "Timeline failed" }, { status: 502, headers: NO_STORE_HEADERS });
  }
}
