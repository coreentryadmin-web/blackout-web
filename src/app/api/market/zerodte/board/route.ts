// 0DTE Command board — the member-facing read of the ALWAYS-ON scanner (see
// src/lib/zerodte/scan.ts). One intraday surface whose mandate is NEW plays:
// single-name 0DTE finds from the HELIX tape, dossier-enriched — never a reprint
// of the SPX engines' plays or Night Hawk's picks (those live on their own pages;
// engine states appear only as a thin context strip). Read-only end to end: every
// engine is consumed via its read-only snapshot projection (never the mutating
// evaluate* paths), so this route can poll at member cadence without advancing
// engine state or firing alerts.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";
import { readSpxPlaySnapshot } from "@/lib/spx-evaluator";
import { readSpxLottoSnapshot } from "@/lib/spx-lotto-engine";
import { readSpxPowerHourSnapshot } from "@/lib/spx-power-hour-engine";
import { buildPlayTechnicals } from "@/lib/spx-play-technicals";
import { computeSpxConfluence } from "@/lib/spx-signals";
import { etNowParts, isTradingDayEt, nextTradingDayEt, todayEt } from "@/lib/nighthawk/session";
import { fetchBenzingaNews } from "@/lib/providers/polygon";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { readGridEarnings } from "@/lib/providers/grid";
import { matchEarnings, matchHotNews, sessionHeat, type EngineCard } from "@/lib/zerodte/board";
import { gradeZeroDteLedger, readZeroDteLedger, scanZeroDteBoard, within } from "@/lib/zerodte/scan";
import { withServerCache, serverCache, TTL } from "@/lib/server-cache";
import { roundFloats } from "@/lib/round-floats";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

export const dynamic = "force-dynamic";

/** One shared board build per BOARD_TTL_MS window across ALL pollers (single-flight
 *  in-process + Redis so replicas share too). The payload is user-independent —
 *  without this, every member's 15s poll would re-run the whole assembly (engines,
 *  400-row tape query, ledger query) independently. Auth stays per-request. */
const BOARD_TTL_MS = 5_000;

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  ensureDataSockets();
  try {
    const payload = await withServerCache("zerodte:board:v1", BOARD_TTL_MS, buildBoardPayload);
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    console.error("[market/zerodte/board]", error);
    return NextResponse.json(
      { available: false, degraded: true },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
    );
  }
}

async function buildBoardPayload() {
  const today = todayEt();
  const tradingDay = isTradingDayEt(today);
  const { hour, minute } = etNowParts();
  const heat = sessionHeat(hour * 60 + minute, tradingDay);

  const { merged } = await loadMergedSpxDesk();
  const technicals = await buildPlayTechnicals(merged.price, {
    vwap: merged.vwap,
    pdh: merged.pdh,
    pdl: merged.pdl,
    hod: merged.hod,
    lod: merged.lod,
  });

  // Context lanes + engine snapshots + today's scanner ledger, in parallel. Each is
  // individually best-effort — one degraded lane must not blank the board. News
  // reuses the market-news cache key (zero extra upstream); earnings reads the
  // grid's Redis-warmed snapshot; the THERMAL matrix is cron-pre-warmed (~20s TTL),
  // soft-deadlined so a cold rebuild can't stall a member poll.
  const [play, lotto, powerHour, news, earningsSnap, thermal, ledger] = await Promise.all([
    readSpxPlaySnapshot(merged, technicals).catch(() => null),
    readSpxLottoSnapshot().catch(() => null),
    readSpxPowerHourSnapshot(merged).catch(() => null),
    serverCache("news:benzinga:15", TTL.NEWS, () => fetchBenzingaNews(15)).catch(() => []),
    readGridEarnings().catch(() => null),
    within(fetchGexHeatmap("SPX").catch(() => null), 2_500),
    readZeroDteLedger(),
  ]);

  const nextDay = nextTradingDayEt(today);
  const earningsFlags = matchEarnings(earningsSnap?.items ?? [], { today, nextDay });
  const newsFlags = matchHotNews(news, Date.now());

  // The hunt itself — same pipeline the cron scanner runs every ~2 min. Between
  // cron ticks a member poll refreshes the live view; dossier enrichment is shared
  // through the same per-ticker cache either way.
  const { setups, nighthawk_covered } = await scanZeroDteBoard({
    earnings: earningsFlags,
    news: newsFlags,
  });

  // Opportunistic, throttled: grade any finished-session ledger rows.
  void gradeZeroDteLedger().catch(() => {});

  // Thin engine context strip — states only. The plays themselves are deliberately
  // NOT reproduced here: this board finds new names; the engines have their own pages.
  const playState: EngineCard["state"] =
    play?.open_play != null ? "ACTIVE" : play?.phase === "WATCHING" ? "ARMED" : play ? "SCANNING" : "OFF";
  const lottoState: EngineCard["state"] =
    lotto?.phase === "BUY" || lotto?.phase === "HOLD"
      ? "ACTIVE"
      : lotto?.phase === "WATCH"
        ? "ARMED"
        : lotto?.phase === "SCAN"
          ? "SCANNING"
          : lotto?.phase === "SELL" || lotto?.phase === "INVALID"
            ? "DONE"
            : "OFF";
  const phState: EngineCard["state"] =
    powerHour?.phase === "HOLD"
      ? "ACTIVE"
      : powerHour?.phase === "WATCH"
        ? "ARMED"
        : powerHour?.phase === "SELL"
          ? "DONE"
          : "OFF";

  const confluence = computeSpxConfluence(merged);

  // Context lanes, trimmed to board-size payloads.
  const newsLane = news.slice(0, 8).map((a) => ({
    title: a.title,
    published: a.published ?? null,
    tickers: (a.tickers ?? []).slice(0, 4),
    url: a.url ?? null,
  }));
  const earningsLane = (earningsSnap?.items ?? [])
    .filter((it) => it.report_date === today || it.report_date === nextDay)
    .slice(0, 10)
    .map((it) => ({
      ticker: it.ticker,
      name: it.name,
      when: it.when,
      report_date: it.report_date,
      expected_move_pct: it.expected_move_pct,
      eps_estimate: it.eps_estimate,
    }));

  return roundFloats({
    available: true,
    as_of: new Date().toISOString(),
    session: {
      date: today,
      trading_day: tradingDay,
      market_label: merged.market_label ?? null,
      heat,
    },
    spx: {
      price: merged.price ?? null,
      change_pct: merged.spx_change_pct ?? null,
      vwap: merged.vwap ?? null,
      gamma_flip: merged.gamma_flip ?? null,
      // Nearest resistance/support strikes from the desk's GEX ladder.
      call_wall:
        merged.gex_walls?.filter((w) => w.kind === "resistance").sort((a, b) => Math.abs(a.distance_pts) - Math.abs(b.distance_pts))[0]?.strike ?? null,
      put_wall:
        merged.gex_walls?.filter((w) => w.kind === "support").sort((a, b) => Math.abs(a.distance_pts) - Math.abs(b.distance_pts))[0]?.strike ?? null,
      max_pain: merged.max_pain ?? null,
      regime: merged.regime ?? null,
      confluence: confluence
        ? { score: confluence.score ?? null, grade: confluence.grade ?? null, bias: confluence.bias ?? null }
        : null,
      // THERMAL dealer-positioning migration (flip/wall drift with real numbers),
      // when the heatmap history window has enough snapshots to diff.
      thermal_shift:
        thermal?.shift?.available && thermal.shift.summary ? thermal.shift.summary : null,
    },
    engine_strip: [
      { kind: "spx_play", state: playState },
      { kind: "lotto", state: lottoState },
      { kind: "power_hour", state: phState },
    ],
    setups,
    // The always-on scanner's session record: every name flagged today, when it was
    // first flagged, at what price, and (after the close) how it graded.
    ledger: ledger.map((r) => ({
      ticker: r.ticker,
      direction: r.direction,
      score_max: r.score_max,
      spike: r.spike,
      first_flagged_at: r.first_flagged_at,
      underlying_at_flag: r.underlying_at_flag,
      top_strike: r.top_strike,
      conviction: r.conviction,
      move_pct: r.move_pct,
      direction_hit: r.direction_hit,
      graded: r.graded_at != null,
    })),
    // Names withheld from the lane because Night Hawk already published them —
    // surfaced so the UI can say WHY a hot ticker isn't listed.
    nighthawk_covered,
    news: newsLane,
    earnings: earningsLane,
  });
}
