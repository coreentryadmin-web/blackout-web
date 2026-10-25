// GET /api/market/swing/record — Swing Command multi-day track record.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  fetchOpenSwingPositions,
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
    // BUG FIX (Ask Largo standing mandate, 2026-10-25): `fetchSwingPositionsRange` filters on
    // `session_date >= since` — a currently OPEN/HOLD/TRIM position whose own session_date (entry
    // date) predates the window is invisible to that query, so `selectSwingRecordRootIds` never
    // seeds its root and the whole chain silently drops out of `records`, undercounting
    // `summary.opens`/`nativeOpens`. "Is this position currently open" is a PRESENT-TENSE fact,
    // not a historical one bounded by how far back `days` happens to look — this file's own
    // `selectSwingRecordRootIds` doc comment already states the intent ("currently OPEN/HOLD/TRIM
    // ... a live, committed position"), the gap was only ever in which rows got handed to it.
    // Live-measured on prod: `?days=1` reported `nativeOpens:0` while `?days=7/30/90` all reported
    // `nativeOpens:2` for the SAME two real positions. Fixed by independently unioning in
    // `fetchOpenSwingPositions()`'s rows (status-filtered, unbounded by date) — fail-soft to `[]`,
    // matching this route's existing per-source fail-soft discipline (see the banger-opens fetch
    // just below), so a DB hiccup on this extra read degrades to the pre-fix behavior rather than
    // failing the whole route.
    const openRows = await fetchOpenSwingPositions().catch(() => []);
    const rootIds = [...new Set([...selectSwingRecordRootIds(rows), ...selectSwingRecordRootIds(openRows)])].slice(
      0,
      MAX_CHAINS,
    );
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
