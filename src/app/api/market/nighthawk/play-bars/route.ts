import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { fetchOptionMinuteBars } from "@/lib/providers/polygon";
import { withServerCache } from "@/lib/server-cache";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Real minute-bar mark history for ONE committed play's contract, since entry.
 *
 * Built to answer a real gap: the play-detail panel had no continuous price chart because no
 * client-facing route served one — `TerminalPlay` only ever carried point-in-time snapshots
 * (entry/mark/peak/trough), and drawing a smooth line through those few points would imply a
 * price path nothing actually measured (see the 2026-08-28 UI-reskin thread — a marker-only
 * chart from those same sparse points was deliberately NOT built for exactly this reason).
 * `fetchOptionMinuteBars` (polygon.ts) is the first PRODUCTION request-time caller of Polygon's
 * per-option minute-agg endpoint — every prior use was offline/audit-only.
 *
 * `occ` must be a real OCC symbol (validated below, not just trusted) — this is a live upstream
 * Polygon call gated behind premium+launched-tool auth, not a public passthrough.
 *
 * Cache: 20s server-side (withServerCache). A resolved 0DTE minute bar never changes once its
 * minute has passed — only the newest (possibly still-forming) bar could — so a short TTL is
 * purely a thundering-herd guard for a play multiple members have open simultaneously, not a
 * staleness compromise; 20s keeps the chart visibly live without re-hitting Polygon on every
 * poll tick from every open detail panel.
 */
const PLAY_BARS_TTL_MS = 20_000;

// O:TICKER YYMMDD C/P STRIKE(8) — Polygon's OCC format. Validated so a malformed/attacker-supplied
// `occ` fails fast with 400 instead of reaching the upstream Polygon call with a client-controlled
// path segment.
const OCC_PATTERN = /^O:[A-Z.]{1,10}\d{6}[CP]\d{8}$/;

function isValidTradingDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export async function GET(req: NextRequest) {
  try {
    const authResult = await authorizeCronOrTierApi(req, "premium");
    if (authResult instanceof Response) return authResult;

    const locked = await requireToolApi("nighthawk");
    if (locked) return locked;

    const { searchParams } = new URL(req.url);
    const occ = (searchParams.get("occ") ?? "").trim().toUpperCase();
    const sinceIso = (searchParams.get("since") ?? "").trim();

    if (!OCC_PATTERN.test(occ)) {
      return NextResponse.json({ error: "occ must be a valid OCC option symbol" }, { status: 400 });
    }
    const sinceMs = Date.parse(sinceIso);
    if (!Number.isFinite(sinceMs)) {
      return NextResponse.json({ error: "since must be a valid ISO instant" }, { status: 400 });
    }

    // A 0DTE contract's whole tradable life is one calendar day — the entry instant's own UTC
    // date IS the Polygon day-range for both `from` and `to` (a same-day play never needs a
    // multi-day range, and requesting one for an expired 0DTE symbol just returns empty results
    // Polygon-side rather than erroring, so this isn't a correctness bug either way — it's the
    // minimal request that always covers the play's real trading window).
    const tradingDay = new Date(sinceMs).toISOString().slice(0, 10);
    if (!isValidTradingDay(tradingDay)) {
      return NextResponse.json({ error: "since did not resolve to a valid trading day" }, { status: 400 });
    }

    const cacheKey = `nighthawk:play-bars:v1:${occ}:${tradingDay}`;
    const bars = await withServerCache(cacheKey, PLAY_BARS_TTL_MS, () =>
      fetchOptionMinuteBars(occ, tradingDay, tradingDay)
    );

    // Trim to entry-forward and to just {t, c} — the chart only ever plots the close, and the
    // pre-entry bars (real Polygon data, but for a period this specific play was never live)
    // would draw a price history that has nothing to do with the play being charted.
    const points = bars
      .filter((b) => b.t != null && b.t >= sinceMs)
      .map((b) => ({ t: new Date(b.t!).toISOString(), c: b.c }));

    return NextResponse.json(
      { occ, since: sinceIso, points },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    // Upstream Polygon failure (rate limit, symbol not found for a very new/illiquid 0DTE
    // contract, etc.) — never a 500 that looks like OUR bug; the chart degrades to "unavailable"
    // client-side rather than fabricating points.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch play bars" },
      { status: 502 }
    );
  }
}
