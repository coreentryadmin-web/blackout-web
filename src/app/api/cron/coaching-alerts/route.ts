import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { buildCoachingAlerts } from "@/features/vector/lib/vector-coaching";
import { isEtCashRth } from "@/lib/et-market-hours";
import { dbQuery, requireDatabaseInProduction } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  try {
    const dispatchAlerts = () => {
      void buildCoachingAlerts()
        .then(async ({ alerts, spxPrice, callWall, putWall, vwap }) => {
          if (!alerts.length) {
            console.info(`[cron/coaching-alerts] background done — no triggers elapsed=${Date.now() - started}ms`);
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
        })
        .catch((err) => {
          console.error("[cron/coaching-alerts] background build REJECTED:", err);
        });
    };

    try {
      after(dispatchAlerts);
    } catch {
      dispatchAlerts();
    }

    const accepted = {
      ok: true,
      status: "accepted",
      reason: "coaching alerts dispatched in background (fire-and-forget)",
    };
    await logCronRun("coaching-alerts", started, accepted);
    return NextResponse.json(
      {
        ...accepted,
        note: "Alert build runs in background — coaching_alerts rows still advance on the ECS worker.",
      },
      { status: 202 }
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await logCronRun("coaching-alerts", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "coaching-alerts failed" }, { status: 500 });
  }
}
