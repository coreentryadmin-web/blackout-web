// GET: returns the most recent regime snapshot — intentionally public (market-wide,
// no user-specific or paid-tier data; equivalent to the CDN-cached GEX endpoint).
// POST: stores a new regime snapshot (called by market-regime-detector cron)

import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { formatEtDate, mostRecentTradingDayEt } from "@/features/nighthawk/lib/session";
import { isEtCashRth } from "@/lib/et-market-hours";
import { roundFloats } from "@/lib/round-floats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };
// Public GET: regime data is market-wide, not user-specific. 30s CDN TTL reduces
// DB load; POST writes are unaffected (no cache on mutations).
const CDN_CACHE = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=10" };

/**
 * `net_gex`/`iv_percentile` are Postgres NUMERIC columns (004_god_tier_features.sql);
 * node-postgres never parses NUMERIC to a JS `number` (avoids silent precision loss on
 * the driver side) — it comes back as a full-precision STRING (confirmed live:
 * "7730543991.5...93"), which was previously serialized verbatim into this route's
 * JSON response, unlike every other NUMERIC-sourced field this codebase serves (see
 * CLAUDE.md's "several endpoints serve unrounded floats" note; same class as the
 * gex-heatmap/gex-positioning fix, roundFloats). Coerce to a real number (preserving
 * SQL NULL as JSON null, never a false `0`) before rounding.
 */
function numericOrNull(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convert a `market_regime` DB row into the camelCase JSON snapshot both the
 * single-latest and history responses ship. Reused so any field change lands
 * in ONE place — the two modes can't drift out of sync. `available` and the
 * derived `stale` / `marketOpen` flags are included so a `?history` snapshot
 * carries the same shape as a single-fetch snapshot (the native app decodes
 * both with one `MarketRegime` Codable).
 */
function shapeSnapshotForClient(row: Record<string, unknown>): Record<string, unknown> {
  const now = new Date();
  const capturedAtMs = row.captured_at ? new Date(row.captured_at as string | number | Date).getTime() : NaN;
  const stale = !Number.isFinite(capturedAtMs)
    ? true
    : formatEtDate(new Date(capturedAtMs)) !== mostRecentTradingDayEt(now);
  return {
    available: true,
    regime: row.composite,
    gexRegime: row.gex_regime,
    volRegime: row.vol_regime,
    trendRegime: row.trend_regime,
    flowRegime: row.flow_regime,
    playbook: row.playbook,
    capturedAt: row.captured_at,
    netGex: roundFloats(numericOrNull(row.net_gex)),
    ivPercentile: roundFloats(numericOrNull(row.iv_percentile)),
    aboveVwap: row.above_vwap,
    stale,
    marketOpen: isEtCashRth(now),
  };
}

export async function GET(req: NextRequest) {
  // Additive history mode — /api/market/regime?history=N returns the last N
  // snapshots newest-first as `{snapshots: [...]}` so the native app's
  // Command "What Changed" timeline can render regime transitions without a
  // new endpoint. When `history` is absent the response shape is UNCHANGED
  // (the existing single-snapshot contract every current caller depends on).
  const historyParam = req.nextUrl.searchParams.get("history");
  if (historyParam != null) {
    // Bound: min 1, max 50. Non-numeric input coerces to 1 (safe default,
    // not a 400 — this matches how our other public read endpoints handle
    // malformed query params: silently clamp rather than reject).
    const requested = Number.parseInt(historyParam, 10);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(requested, 50)) : 1;
    try {
      const result = await dbQuery(
        "SELECT * FROM market_regime ORDER BY captured_at DESC LIMIT $1",
        [limit]
      );
      const snapshots = (result.rows as Array<Record<string, unknown>>).map(shapeSnapshotForClient);
      return NextResponse.json({ snapshots }, { status: 200, headers: CDN_CACHE });
    } catch {
      return NextResponse.json({ snapshots: [] }, { status: 200, headers: NO_STORE });
    }
  }
  try {
    const result = await dbQuery(
      "SELECT * FROM market_regime ORDER BY captured_at DESC LIMIT 1",
      []
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ available: false }, { status: 200, headers: NO_STORE });
    }
    // Both the single-latest and ?history modes use `shapeSnapshotForClient`
    // so the response contract can't drift. See its docstring for the
    // staleness (task #173) rules — those still apply here.
    return NextResponse.json(
      shapeSnapshotForClient(result.rows[0] as Record<string, unknown>),
      { status: 200, headers: CDN_CACHE }
    );
  } catch {
    return NextResponse.json({ available: false }, { status: 200, headers: NO_STORE });
  }
}

export async function POST(req: NextRequest) {
  // Constant-time CRON_SECRET check for cron writes; fail-closed when the secret is unset.
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    await dbQuery(
      `INSERT INTO market_regime (gex_regime, vol_regime, trend_regime, flow_regime, composite, playbook, net_gex, iv_percentile, above_vwap, flow_ratio, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [body.gex_regime, body.vol_regime, body.trend_regime, body.flow_regime,
       body.composite, body.playbook, body.net_gex, body.iv_percentile,
       body.above_vwap, body.flow_ratio, JSON.stringify(body)]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Cron-only write path, but still don't forward raw exception text (Postgres driver/
    // constraint errors can embed internal detail) -- log server-side, return a fixed string.
    // Same pattern established in /api/ready (task #66).
    console.error("[market/regime] POST failed:", err);
    return NextResponse.json({ error: "Failed to store regime snapshot" }, { status: 500 });
  }
}
