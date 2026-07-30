import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { buildCoachingAlerts } from "@/features/vector/lib/vector-coaching";
import { isEtCashRth } from "@/lib/et-market-hours";
import { dbQuery, requireDatabaseInProduction } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function runCoachingAlertsTick(started: number): Promise<void> {
  try {
    const { alerts, spxPrice, callWall, putWall, vwap } = await buildCoachingAlerts();
    if (!alerts.length) {
      console.info(
        `[cron/coaching-alerts] background done — no triggers elapsed=${Date.now() - started}ms`
      );
      return;
    }

    await Promise.all(
      alerts.map((a) =>
        dbQuery(
          `INSERT INTO coaching_alerts (trigger_type, alert_text, urgency, spx_price, call_wall, put_wall, vwap, for_longs, for_shorts, raw)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            a.trigger,
            a.alert,
            a.urgency,
            spxPrice,
            callWall,
            putWall,
            vwap,
            a.for_longs ?? true,
            a.for_shorts ?? false,
            JSON.stringify(a),
          ]
        )
      )
    );

    console.info(
      `[cron/coaching-alerts] background done — written=${alerts.length} elapsed=${Date.now() - started}ms`
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[cron/coaching-alerts] background REJECTED: ${detail}`);
  }
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isEtCashRth()) {
    const payload = { ok: true, skipped: true, reason: "Outside cash RTH" };
    await logCronRun("coaching-alerts", started, payload);
    return NextResponse.json(payload);
  }

  // buildCoachingAlerts() can block on cold desk/GEX cache rebuilds and exceed Cloudflare's
  // ~100s origin timeout (RTH finding 2026-07-30: HTTP 504, no cron_job_runs row). Mirror
  // zerodte-warm: handshake in seconds, heavy work in after() on the long-lived ECS worker.
  const dispatchTick = () => {
    void runCoachingAlertsTick(started).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[cron/coaching-alerts] background tick REJECTED: ${detail}`);
    });
  };

  try {
    after(dispatchTick);
  } catch {
    dispatchTick();
  }

  const accepted = {
    ok: true,
    status: "accepted",
    reason: "coaching scan dispatched in background (fire-and-forget)",
  };
  await logCronRun("coaching-alerts", started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Alert build + PG writes run in background — cron handshake stays under edge timeout.",
    },
    { status: 202 }
  );
}
