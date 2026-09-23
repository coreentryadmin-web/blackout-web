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
import { buildSwingRecord, buildSwingRecordSummary, selectSwingRecordRootIds } from "@/lib/swing/record";
import { fetchBangerOpenCount } from "@/lib/banger/positions-db";
import { isBangerEngineEnabled } from "@/lib/banger/flag";
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
    const rootIds = selectSwingRecordRootIds(rows).slice(0, MAX_CHAINS);
    const chains = await Promise.all(rootIds.map((id) => fetchSwingPositionChain(id)));
    const records = chains.map((chain) => buildSwingRecord(chain));
    const nativeSummary = buildSwingRecordSummary(records, { since, through, days });
    // Engine B (Banger) open positions live in a separate table (banger_positions) and are
    // structurally invisible to fetchSwingPositionsRange/fetchSwingPositionChain above — the
    // same split already fixed for bookContextSection's live-book read (docs/audit/FINDINGS.md,
    // "Ask Largo swing Book context... blind to 94% of the live open book"). Without this,
    // `opens` (and the member-facing SwingAnalyticsPanel "Open" tile) undercounts the real open
    // book by ~96% on a book dominated by banger-origin positions. Fail-soft: a banger DB hiccup
    // falls back to 0 rather than failing the whole route, matching the existing per-source
    // fail-soft discipline in play-brief-context.ts's loadOpenBook().
    const bangerOpens = isBangerEngineEnabled() ? await fetchBangerOpenCount().catch(() => 0) : 0;
    const summary = {
      ...nativeSummary,
      opens: nativeSummary.opens + bangerOpens,
      nativeOpens: nativeSummary.opens,
      bangerOpens,
    };
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
