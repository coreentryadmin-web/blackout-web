import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authorizeMarketDeskApi, isCronAuthorized } from "@/lib/market-api-auth";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { coachingAlertAgeFields } from "@/lib/coaching-alert-age";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Paid SPX coaching (live walls/VWAP + long/short calls) — premium session or cron only.
  const authResult = await authorizeMarketDeskApi(req);
  if (authResult instanceof Response) return authResult;
  try {
    const result = await dbQuery(
      "SELECT * FROM coaching_alerts ORDER BY generated_at DESC LIMIT 10",
      []
    );
    const now = Date.now();
    return NextResponse.json({
      alerts: result.rows.map(r => {
        const generatedAt = r.generated_at;
        // coachingAlertAgeFields clamps a future-dated generated_at (RDS-vs-app clock skew)
        // at zero instead of letting Math.floor turn it into a negative "-N minutes ago".
        const { ageMinutes, stale } = coachingAlertAgeFields(generatedAt, now);
        return {
          id: r.id,
          generatedAt,
          age_minutes: ageMinutes,
          stale,
          trigger: r.trigger_type,
          alert: r.alert_text,
          urgency: r.urgency,
          spxPrice: r.spx_price,
          callWall: r.call_wall,
          putWall: r.put_wall,
          vwap: r.vwap,
          forLongs: r.for_longs,
          forShorts: r.for_shorts,
        };
      })
    }, { status: 200, headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ alerts: [] }, { status: 200, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  // Constant-time CRON_SECRET check; fail-closed when the secret is unset.
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const { alerts, spxPrice, callWall, putWall, vwap } = body;
    if (!Array.isArray(alerts) || alerts.length === 0) return NextResponse.json({ ok: true });
    await Promise.all(alerts.map((a: { trigger: string; alert: string; urgency: string; for_longs?: boolean; for_shorts?: boolean }) =>
      dbQuery(
        `INSERT INTO coaching_alerts (trigger_type, alert_text, urgency, spx_price, call_wall, put_wall, vwap, for_longs, for_shorts, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [a.trigger, a.alert, a.urgency, spxPrice, callWall, putWall, vwap, a.for_longs ?? true, a.for_shorts ?? false, JSON.stringify(a)]
      )
    ));
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Cron-only write path, but still don't forward raw exception text (Postgres driver/
    // constraint errors can embed internal detail) -- log server-side, return a fixed string.
    // Same pattern established in /api/ready (task #66).
    console.error("[coaching/alerts] POST failed:", err);
    return NextResponse.json({ error: "Failed to store coaching alerts" }, { status: 500 });
  }
}
