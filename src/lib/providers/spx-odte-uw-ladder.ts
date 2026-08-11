import { fetchUwOdteSpotExposuresByStrike } from "@/lib/providers/unusual-whales";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { hasLiveGexStrikeExpiry, getGexStrikeExpiryLadder } from "@/lib/ws/uw-socket";

export type SpxOdteUwLadderResult = {
  /** Per-strike net gamma rows in {strike, call_gamma_oi, put_gamma_oi} shape. */
  rows: Record<string, unknown>[];
  /** Human-readable source label for correctness logs. */
  source: string;
};

/** Convert a per-strike net ladder to UW row shape (call+put === net). */
export function uwRowsFromStrikeLadder(ladder: ReadonlyMap<number, number>): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const [strike, net] of ladder) {
    if (!Number.isFinite(strike) || strike <= 0 || !Number.isFinite(net) || net === 0) continue;
    rows.push({ strike, call_gamma_oi: net, put_gamma_oi: 0 });
  }
  return rows;
}

/** Build a strike→net map from normalized UW rows. */
export function strikeLadderFromUwRows(rows: ReadonlyArray<Record<string, unknown>>): Map<number, number> {
  const ladder = new Map<number, number>();
  for (const r of rows) {
    const strike = Number(r.strike);
    const net = Number(r.call_gamma_oi ?? 0) + Number(r.put_gamma_oi ?? 0);
    if (Number.isFinite(strike) && strike > 0 && Number.isFinite(net) && net !== 0) {
      ladder.set(strike, net);
    }
  }
  return ladder;
}

/** Normalize UW spot-exposures/expiry-strike rows to the ladder oracle shape. */
export function normalizeUwOdteSpotExposureRows(
  raw: ReadonlyArray<Record<string, unknown>>
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const r of raw) {
    const strike = Number(r.strike ?? r.strike_price);
    if (!Number.isFinite(strike) || strike <= 0) continue;
    let callG = Number(r.call_gamma_oi ?? r.call_gex ?? r.call_gamma ?? NaN);
    let putG = Number(r.put_gamma_oi ?? r.put_gex ?? r.put_gamma ?? NaN);
    if (!Number.isFinite(callG) && !Number.isFinite(putG)) {
      const net = Number(r.gamma_oi ?? r.net_gamma_oi ?? r.gex ?? r.net_gex ?? NaN);
      if (!Number.isFinite(net)) continue;
      callG = net;
      putG = 0;
    } else {
      callG = Number.isFinite(callG) ? callG : 0;
      putG = Number.isFinite(putG) ? putG : 0;
    }
    rows.push({ strike, call_gamma_oi: callG, put_gamma_oi: putG });
  }
  return rows;
}

/**
 * Pick the ladder overlay + correctness oracle should share.
 * REST 0DTE is authoritative when present — WS can disagree on King/net sign on the web tier
 * (stale gex_strike_expiry bridge vs live spot-exposures/expiry-strike), which false-flagged
 * ops-auto-fix #2008 (King 7480 vs 7775, net-GEX sign flip).
 */
export function resolveSpxOdteUwLadderSource(
  rest: SpxOdteUwLadderResult | null | undefined,
  ws: SpxOdteUwLadderResult | null | undefined
): SpxOdteUwLadderResult {
  if (rest?.rows.length) return rest;
  if (ws?.rows.length) return ws;
  return { rows: [], source: "none" };
}

async function fetchSpxOdteScopedUwLadderRest(sym: string): Promise<SpxOdteUwLadderResult | null> {
  try {
    const raw = await fetchUwOdteSpotExposuresByStrike(sym);
    const rows = normalizeUwOdteSpotExposureRows(raw);
    if (rows.length) {
      return { rows, source: "spot-exposures/expiry-strike (0DTE)" };
    }
  } catch {
    /* fall through */
  }
  return null;
}

function fetchSpxOdteScopedUwLadderWs(sym: string, today: string): SpxOdteUwLadderResult | null {
  if (sym !== "SPX" || !hasLiveGexStrikeExpiry(sym)) return null;
  const ws = getGexStrikeExpiryLadder(sym, [today]);
  if (!ws || ws.ladder.size === 0) return null;
  return {
    rows: uwRowsFromStrikeLadder(ws.ladder),
    source: "gex_strike_expiry WS (0DTE)",
  };
}

/**
 * 0DTE-scoped UW GEX ladder — the single source of truth for SPX King alignment.
 *
 * Priority (same for overlay + correctness oracle):
 *   1. REST `spot-exposures/expiry-strike` for today (0DTE) — authoritative oracle
 *   2. UW WS `gex_strike_expiry` for today's ET expiry (when REST 503/empty)
 *
 * Does NOT fall back to `greek-exposure/strike` (cumulative) — that ladder sums ALL
 * expiries and produces a different King than the served 0DTE matrix column. Comparing
 * 0DTE vs cumulative was the root cause of ops-auto-fix #1865 (King 7750 vs 7900).
 */
export async function fetchSpxOdteScopedUwLadder(ticker = "SPX"): Promise<SpxOdteUwLadderResult> {
  const sym = ticker.toUpperCase();
  const today = todayEtYmd();
  const rest = await fetchSpxOdteScopedUwLadderRest(sym);
  const ws = fetchSpxOdteScopedUwLadderWs(sym, today);
  return resolveSpxOdteUwLadderSource(rest, ws);
}

/** Overlay ladder cache — align with SPX heatmap TTL so UW King does not lag Polygon refresh. */
function scopedLadderCacheMs(): number {
  const sec = Number(process.env.SPX_GEX_HEATMAP_CACHE_SEC ?? 5);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 5_000;
}

/** In-process cache shared by overlay + repeated heatmap reads. */
let cachedScoped: { at: number; result: SpxOdteUwLadderResult } | null = null;

/** Cached 0DTE ladder as a strike→net map (overlay hot path). */
export async function getSpxOdteScopedUwLadderMap(): Promise<Map<number, number> | null> {
  const now = Date.now();
  if (cachedScoped && now - cachedScoped.at < scopedLadderCacheMs()) {
    return strikeLadderFromUwRows(cachedScoped.result.rows);
  }
  const result = await fetchSpxOdteScopedUwLadder("SPX");
  if (!result.rows.length) return null;
  cachedScoped = { at: now, result };
  return strikeLadderFromUwRows(result.rows);
}

/** Test hook — reset the in-process scoped ladder cache. */
export function resetSpxOdteScopedUwLadderCacheForTests(): void {
  cachedScoped = null;
}
