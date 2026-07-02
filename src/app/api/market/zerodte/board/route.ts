// 0DTE Command board — one intraday surface composing the EXISTING graded engines
// (SPX play / lotto / power hour), live SPX structure, and single-name 0DTE flow
// setups from the HELIX tape. Read-only end to end: every engine is consumed via
// its read-only snapshot projection (never the mutating evaluate* paths), so this
// route can poll at member cadence without advancing engine state or firing alerts.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchRecentFlows, requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { loadMergedSpxDesk } from "@/lib/spx-desk-loader";
import { readSpxPlaySnapshot } from "@/lib/spx-evaluator";
import { readSpxLottoSnapshot } from "@/lib/spx-lotto-engine";
import { readSpxPowerHourSnapshot } from "@/lib/spx-power-hour-engine";
import { buildPlayTechnicals } from "@/lib/spx-play-technicals";
import { fetchRecentPlayOutcomes } from "@/lib/spx-play-outcomes";
import { computeSpxConfluence } from "@/lib/spx-signals";
import { etNowParts, isTradingDayEt, todayEt } from "@/lib/nighthawk/session";
import { INDEX_SET, LEVERAGED_ETP_SET } from "@/lib/nighthawk/constants";
import { createDossierBuildCache, fetchTickerDossier } from "@/lib/nighthawk/dossier";
import {
  deriveZeroDteSetups,
  enrichSetup,
  rankEngineCards,
  sessionHeat,
  type EngineCard,
  type SetupDossierView,
  type ZeroDteSetup,
} from "@/lib/zerodte/board";
import { withServerCache } from "@/lib/server-cache";
import { roundFloats } from "@/lib/round-floats";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

export const dynamic = "force-dynamic";

/** SPX/SPY/index products are covered by the SPX engines on this board — the
 *  single-name setups lane excludes them plus the leveraged wrappers. */
const SETUP_EXCLUDES = new Set<string>([...INDEX_SET, ...LEVERAGED_ETP_SET, "SPX", "SPY", "QQQ", "IWM"]);

/** Top setups get the full Night Hawk dossier (technicals, dark pool, streaks,
 *  congress, catalysts, deterministic score) — capped to keep inside UW budgets. */
const ENRICH_TOP_N = 5;
const DOSSIER_CACHE_TTL_MS = 10 * 60 * 1000;
/** How long a member poll waits for a COLD dossier before serving the un-enriched
 *  setup. The cache loader keeps running after we stop waiting, so the next poll
 *  (~15s later) gets the enriched row instantly — the board "heats up". */
const ENRICH_WAIT_MS = 3_000;

/** Await `p` for at most `ms`, else null — without cancelling `p` (it continues
 *  in the background and populates the server cache). */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

/** Enrich the top setups with the full (cached) Night Hawk dossier + deterministic
 *  scorer — flow streaks, Polygon technicals/breakouts, dark pool, news/catalysts,
 *  analyst PT, congress/institutional. Regime context is intentionally null here:
 *  the intraday board wants the raw factor read, not the evening regime multiplier. */
async function enrichSetups(setups: ZeroDteSetup[]) {
  const buildCache = createDossierBuildCache();
  const today = todayEt();
  return Promise.all(
    setups.map(async (setup, i) => {
      if (i >= ENRICH_TOP_N) return enrichSetup(setup, null);
      // Single-flight per ticker per 10-min window across all pollers (Redis-backed),
      // so member polling never multiplies dossier builds.
      const dossier = await within(
        withServerCache<SetupDossierView>(
          `zerodte:dossier:${setup.ticker}:${today}`,
          DOSSIER_CACHE_TTL_MS,
          () => fetchTickerDossier(setup.ticker, null, buildCache)
        ),
        ENRICH_WAIT_MS
      );
      return enrichSetup(setup, dossier);
    })
  );
}

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  ensureDataSockets();
  try {
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

    // Read-only engine snapshots + tape + today's closed plays, in parallel. Each is
    // individually best-effort — one degraded engine must not blank the board.
    const [play, lotto, powerHour, flows, outcomes] = await Promise.all([
      readSpxPlaySnapshot(merged, technicals).catch(() => null),
      readSpxLottoSnapshot().catch(() => null),
      readSpxPowerHourSnapshot(merged).catch(() => null),
      fetchRecentFlows({ since_hours: 7, min_premium: 150_000, order: "premium", limit: 400 }).catch(
        () => []
      ),
      fetchRecentPlayOutcomes(30).catch(() => []),
    ]);

    const rawSetups = deriveZeroDteSetups(
      flows.map((f) => ({
        ticker: f.ticker,
        premium: f.premium,
        option_type: f.option_type,
        strike: f.strike,
        expiry: f.expiry,
        dte: f.dte,
        alert_rule: f.alert_rule,
        ask_pct: f.ask_pct,
        underlying_price: f.underlying_price,
        alerted_at: f.alerted_at,
      })),
      { maxSetups: 8, excludeTickers: SETUP_EXCLUDES }
    );
    const setups = await enrichSetups(rawSetups);

    // Engine card states — deterministic mapping from each payload's own phase.
    const playState: EngineCard["state"] =
      play?.open_play != null ? "ACTIVE" : play?.phase === "WATCHING" ? "ARMED" : play ? "SCANNING" : "OFF";
    // LottoPhase: SCAN|WATCH|BUY|HOLD|SELL|INVALID|NONE — BUY/HOLD are a live managed
    // lotto; WATCH is armed-and-waiting on its trigger; SELL/INVALID are finished.
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
    // PowerHourPhase: NONE|WATCH|HOLD|SELL.
    const phState: EngineCard["state"] =
      powerHour?.phase === "HOLD"
        ? "ACTIVE"
        : powerHour?.phase === "WATCH"
          ? "ARMED"
          : powerHour?.phase === "SELL"
            ? "DONE"
            : "OFF";

    const ranked = rankEngineCards(
      [
        { kind: "spx_play", state: playState },
        { kind: "lotto", state: lottoState },
        { kind: "power_hour", state: phState },
      ],
      heat.state === "POWER_HOUR"
    );

    // Today's graded plays only — the intraday day-log, graded by the same engine
    // that grades the track record. session_date is the grading key (ET session),
    // so this can't drift across the UTC midnight boundary the way slicing
    // closed_at timestamps would. Open plays already show on the engine cards.
    const dayLog = outcomes
      .filter((o) => o.session_date === today && o.outcome !== "open")
      .slice(0, 12);

    const confluence = computeSpxConfluence(merged);

    return NextResponse.json(
      roundFloats({
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
        },
        engines: {
          order: ranked,
          play,
          lotto,
          power_hour: powerHour,
        },
        setups,
        day_log: dayLog,
      }),
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
        },
      }
    );
  } catch (error) {
    console.error("[market/zerodte/board]", error);
    return NextResponse.json(
      { available: false, degraded: true },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
    );
  }
}
