// GET /api/market/swing/record — Swing Command multi-day track record.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  fetchSwingPositionChain,
  fetchSwingPositionsRange,
  requireDatabaseInProduction,
} from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { buildSwingRecord, buildSwingRecordSummary } from "@/lib/swing/record";
import { closedDeckSourcesFromChains } from "@/lib/swing/closed-plays";
import { formatEtDate, todayEt } from "@/features/nighthawk/lib/session";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const MAX_ROWS = 2000;
const MAX_CHAINS = 200;

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  if (authResult.via === "user") {
    const nighthawkDenied = await requireToolApi("nighthawk");
    if (nighthawkDenied) return nighthawkDenied;
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const days = Math.min(
    MAX_DAYS,
    Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS) || DEFAULT_DAYS),
  );
  const through = todayEt();
  const since = formatEtDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

  try {
    const rows = await fetchSwingPositionsRange(since, Math.min(MAX_ROWS, days * 40));
    const roots = new Set<number>();
    for (const row of rows) {
      if (!row.graded_at) continue;
      roots.add(row.root_position_id ?? row.id);
    }
    const rootIds = [...roots].slice(0, MAX_CHAINS);
    const chains = await Promise.all(rootIds.map((id) => fetchSwingPositionChain(id)));
    const records = chains.map((chain) => buildSwingRecord(chain));
    const summary = buildSwingRecordSummary(records, { since, through, days });
    const closedDeck = closedDeckSourcesFromChains(chains);
    return NextResponse.json(
      roundFloats({
        available: true,
        summary,
        records,
        closedDeck,
      }),
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[market/swing/record]", error);
    return NextResponse.json({ available: false, degraded: true }, { headers: NO_STORE_HEADERS });
  }
}
