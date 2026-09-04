import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { isCronAuthorized, requireTierApi } from "@/lib/market-api-auth";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const authResult = await requireTierApi("premium");
  if (authResult instanceof Response) return authResult;
  try {
    const result = await dbQuery(
      "SELECT * FROM flow_anomalies ORDER BY detected_at DESC LIMIT 20",
      []
    );
    return NextResponse.json(
      roundFloats({
        anomalies: result.rows.map(r => ({
          id: r.id,
          detectedAt: r.detected_at,
          type: r.anomaly_type,
          ticker: r.ticker,
          detail: r.detail,
          premium: r.premium,
          direction: r.direction,
          severity: r.severity,
        })),
      }),
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch {
    return NextResponse.json({ anomalies: [] }, { status: 200, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  // Constant-time CRON_SECRET check; fail-closed when the secret is unset.
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const { anomalies } = body;
    if (!Array.isArray(anomalies) || anomalies.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0 });
    }
    await Promise.all(anomalies.map((a: { type: string; ticker?: string; detail: string; premium?: number; direction?: string; severity: string }) =>
      dbQuery(
        `INSERT INTO flow_anomalies (anomaly_type, ticker, detail, premium, direction, severity, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [a.type, a.ticker, a.detail, a.premium, a.direction, a.severity, JSON.stringify(a)]
      )
    ));
    return NextResponse.json({ ok: true, inserted: anomalies.length });
  } catch (err) {
    // Cron-only write path, but still don't forward raw exception text (Postgres driver/
    // constraint errors can embed internal detail) -- log server-side, return a fixed string.
    // Same pattern established in /api/ready (task #66).
    console.error("[market/anomalies] POST failed:", err);
    return NextResponse.json({ error: "Failed to store anomalies" }, { status: 500 });
  }
}
