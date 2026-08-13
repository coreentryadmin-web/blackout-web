import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { peekGexHeatmapCache } from "@/lib/providers/polygon-options-gex";
import { requireAnyToolApi } from "@/lib/tool-access-server";
import { THERMAL_COMPARE_PRESET_SIZE } from "@/features/thermal/lib/thermal-compare-presets";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { joinGexStrikeExpiryTicker } from "@/lib/ws/uw-socket";
import { registerVectorUniverseView } from "@/features/vector/lib/vector-universe";
import type { HeatmapMemberPayload } from "@/lib/gex-heatmap-member";
import {
  loadHeatmapCacheReaderOnly,
  memberPayloadFromHeatmap,
  scheduleHeatmapBackgroundWarm,
} from "@/lib/gex-heatmap-member-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Align with single-ticker route + Thermal manual ↻ cadence. */
const FORCE_THROTTLE_MS = 5_000;
const lastForceAt = new Map<string, number>();

function parseTickers(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{1,8}$/.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= THERMAL_COMPARE_PRESET_SIZE) break;
  }
  return out;
}

/**
 * GET /api/market/gex-heatmap/batch?tickers=NVDA,AAPL,MSFT&compact=1
 *
 * One cache-reader round trip for the Thermal compare grid — parallel snapshot reads,
 * never N blocking cold chain builds on the member request path.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireAnyToolApi(["spx", "heatmap"]);
  if (locked) return locked;

  const tickers = parseTickers(req.nextUrl.searchParams.get("tickers"));
  if (!tickers.length) {
    return NextResponse.json({ error: "Missing tickers" }, { status: 400 });
  }

  const forceRequested = req.nextUrl.searchParams.get("force") === "1";
  const now0 = Date.now();

  const results = await Promise.all(
    tickers.map(async (ticker) => {
      const lastForce = lastForceAt.get(ticker) ?? 0;
      const forceRefresh = forceRequested && now0 - lastForce >= FORCE_THROTTLE_MS;
      if (forceRefresh) {
        if (lastForceAt.size > 200) lastForceAt.clear();
        lastForceAt.set(ticker, now0);
      }

      joinGexStrikeExpiryTicker(ticker);
      registerVectorUniverseView(ticker);

      const matrixPeek = await peekGexHeatmapCache(ticker);
      const heatmap = await loadHeatmapCacheReaderOnly(ticker, forceRefresh);
      if (
        !forceRefresh &&
        matrixPeek.cached &&
        matrixPeek.age_sec != null &&
        matrixPeek.ttl_sec != null &&
        matrixPeek.age_sec >= matrixPeek.ttl_sec
      ) {
        scheduleHeatmapBackgroundWarm(ticker);
      }

      const payload = memberPayloadFromHeatmap(heatmap);
      return [ticker, payload] as const;
    })
  );

  const tickersOut: Record<string, HeatmapMemberPayload> = {};
  for (const [ticker, payload] of results) {
    if (payload) tickersOut[ticker] = payload;
  }

  return NextResponse.json(
    { tickers: tickersOut },
    { headers: NO_STORE_HEADERS }
  );
}
