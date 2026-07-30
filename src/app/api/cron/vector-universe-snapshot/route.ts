import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { refreshVectorUniverseSnapshot, loadSessionWallHistory } from "@/features/vector";
import { isEtCashRth } from "@/lib/et-market-hours";
import { todayEt } from "@/features/nighthawk/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

async function runVectorUniverseSnapshot(started: number): Promise<void> {
  const sessionYmd = todayEt();
  const snap = await refreshVectorUniverseSnapshot({
    recordWallHistory: true,
    sessionYmd,
  });
  const spxRailLen = await loadSessionWallHistory(sessionYmd, "SPX")
    .then((h) => h.length)
    .catch(() => -1);
  const [spx0dteRailLen, spxWeeklyRailLen, spxMonthlyRailLen] = await Promise.all([
    loadSessionWallHistory(sessionYmd, "SPX", "0dte").then((h) => h.length).catch(() => -1),
    loadSessionWallHistory(sessionYmd, "SPX", "weekly").then((h) => h.length).catch(() => -1),
    loadSessionWallHistory(sessionYmd, "SPX", "monthly").then((h) => h.length).catch(() => -1),
  ]);
  console.info(
    `[cron/vector-universe-snapshot] background done — rows=${snap.rows.length} spxRailLen=${spxRailLen} ` +
      `spx0dteRailLen=${spx0dteRailLen} spxWeeklyRailLen=${spxWeeklyRailLen} spxMonthlyRailLen=${spxMonthlyRailLen} ` +
      `sessionYmd=${sessionYmd} elapsed=${Date.now() - started}ms`
  );
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isEtCashRth()) {
    const payload = { ok: true, skipped: true, reason: "Outside cash RTH" };
    await logCronRun("vector-universe-snapshot", started, payload);
    return NextResponse.json(payload);
  }

  // refreshVectorUniverseSnapshot × ~25 tickers + wall-history recording can exceed Cloudflare's
  // ~100s origin timeout when caches are cold (ops #1360: market_hours_stale with no fresh row).
  // Mirror vector-full-state-snapshot / vector-dark-pool-warm: handshake in seconds, sweep in after().
  const dispatchSnapshot = () => {
    void runVectorUniverseSnapshot(started).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[cron/vector-universe-snapshot] background snapshot REJECTED: ${detail}`);
    });
  };

  try {
    after(dispatchSnapshot);
  } catch {
    dispatchSnapshot();
  }

  const accepted = {
    ok: true,
    status: "accepted",
    reason: "Vector universe snapshot dispatched in background (fire-and-forget)",
    sessionYmd: todayEt(),
  };
  await logCronRun("vector-universe-snapshot", started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Universe GEX wall summary + wall-history recording run in background — handshake stays under edge timeout.",
    },
    { status: 202 }
  );
}
