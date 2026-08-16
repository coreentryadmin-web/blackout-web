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
  try {
    // Record wall-history samples for the whole universe on every RTH run — the
    // server-side source for the chart's bead rails, so they persist after-hours
    // and exist for every covered ticker (not just ones with a live viewer).
    // Only this RTH-gated cron records; inline scanner polls must not.
    const sessionYmd = todayEt();
    const snap = await refreshVectorUniverseSnapshot({
      recordWallHistory: true,
      sessionYmd,
      wallWriteSource: "cron-universe-snapshot",
    });
    // Read-back verification of the flagship rail. The recorder persists to Redis as
    // a side effect, but a green {ok, rows} said nothing about whether the wall-history
    // rail actually grew — a session-long persistence gap (empty off-hours SPX rail)
    // hid behind a passing cron for hours. Reading SPX's rail straight back after the
    // build turns durability into an observable number: force-run twice and railLen
    // must increment; if it stays flat while rows=21, the write path (not the fetch)
    // is the problem. Best-effort — a read hiccup must not fail the recording run.
    const spxRailLen = await loadSessionWallHistory(sessionYmd, "SPX")
      .then((h) => h.length)
      .catch(() => -1);
    const [spx0dteRailLen, spxWeeklyRailLen, spxMonthlyRailLen] = await Promise.all([
      loadSessionWallHistory(sessionYmd, "SPX", "0dte").then((h) => h.length).catch(() => -1),
      loadSessionWallHistory(sessionYmd, "SPX", "weekly").then((h) => h.length).catch(() => -1),
      loadSessionWallHistory(sessionYmd, "SPX", "monthly").then((h) => h.length).catch(() => -1),
    ]);
    console.info(
      `[cron/vector-universe-snapshot] background done — rows=${snap.rows.length} spxRailLen=${spxRailLen} spx0dteRailLen=${spx0dteRailLen} spxWeeklyRailLen=${spxWeeklyRailLen} spxMonthlyRailLen=${spxMonthlyRailLen} sessionYmd=${sessionYmd} elapsed=${Date.now() - started}ms`
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[cron/vector-universe-snapshot] background REJECTED: ${detail}`);
  }
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

  // refreshVectorUniverseSnapshot + wall-history read-backs can exceed Cloudflare's ~100s
  // origin timeout when caches are cold (live probe: HTTP 504 @ 120s during #1355 cleanup).
  // Mirror vector-full-state-snapshot: handshake in seconds, recorder in after().
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
      note: "Universe wall-summary + wall-history recorder runs in background — handshake stays under edge timeout.",
    },
    { status: 202 }
  );
}
