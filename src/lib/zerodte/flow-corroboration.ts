// ── Targeted FLOW corroboration for BREAKOUT tickers (Phase 3a follow-up) ─────────
// The global FLOW fetch ranks by premium across ALL tickers (limit 500, max_dte 1).
// Whole-market BREAKOUT names (mid-cap momentum) rarely appear in that head — so
// mergeDiscoveryOrigins almost never unions ["FLOW","BREAKOUT"]. Measured 2026-08-25:
// 29 BREAKOUT + 7 FLOW setups, 0 multi-rail merges despite several shared mega-cap names.
//
// After BREAKOUT discovery merges, this pass fetches each BREAKOUT-only ticker's own
// near-dated tape and runs the SAME deriveZeroDteSetups evidence gates. A surviving
// FLOW setup is merged onto the breakout row (v2 policy: same-direction → +8 boost,
// origins union). Pure merge helpers live here; IO orchestration is in scan.ts.

import type { EarningsFlag, EnrichedZeroDteSetup, NewsHeat, ZeroDteSetup } from "./board";
import { deriveZeroDteSetups, enrichSetup, mergeSameTickerDiscovery } from "./board";

/** Max BREAKOUT-only tickers to probe per scan (Postgres reader — bounded). */
export const FLOW_CORROBORATION_MAX_TICKERS = 20;

/** Match the primary FLOW discovery window in scan.ts. */
export const FLOW_CORROBORATION_SINCE_HOURS = 7;

/** Per-ticker flow row cap — enough prints to aggregate, not a full tape dump. */
export const FLOW_CORROBORATION_LIMIT = 200;

/** ON by default. Set ZERODTE_FLOW_CORROBORATION=0 to disable. */
export function flowCorroborationEnabled(): boolean {
  return process.env.ZERODTE_FLOW_CORROBORATION !== "0";
}

/** Tickers on the board with BREAKOUT but no FLOW origin yet. */
export function breakoutOnlyTickers(setups: ReadonlyArray<Pick<EnrichedZeroDteSetup, "ticker" | "discovery_origin">>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of setups) {
    const key = s.ticker.toUpperCase();
    if (seen.has(key)) continue;
    const origins = Array.isArray(s.discovery_origin) ? s.discovery_origin : [];
    if (origins.includes("BREAKOUT") && !origins.includes("FLOW")) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/** Run deriveZeroDteSetups on a targeted ticker tape (same gates as global FLOW). */
export function deriveFlowCorroborationSetups(
  rows: Parameters<typeof deriveZeroDteSetups>[0],
  opts: { todayYmd: string; nowMs: number; excludeTickers?: Set<string> }
): ZeroDteSetup[] {
  return deriveZeroDteSetups(rows, {
    maxSetups: 48,
    excludeTickers: opts.excludeTickers,
    nowMs: opts.nowMs,
    todayYmd: opts.todayYmd,
  });
}

/**
 * Merge targeted FLOW setups onto existing BREAKOUT-only rows in place.
 * Returns how many tickers gained a FLOW origin.
 */
export function applyFlowCorroboration(
  setups: EnrichedZeroDteSetup[],
  corroborating: ReadonlyArray<EnrichedZeroDteSetup>
): number {
  if (corroborating.length === 0) return 0;
  const byTicker = new Map<string, EnrichedZeroDteSetup>();
  for (const f of corroborating) {
    const key = f.ticker.toUpperCase();
    if (!byTicker.has(key)) byTicker.set(key, f);
  }
  let merged = 0;
  for (let i = 0; i < setups.length; i++) {
    const s = setups[i]!;
    const key = s.ticker.toUpperCase();
    const flow = byTicker.get(key);
    if (!flow) continue;
    const origins = s.discovery_origin ?? [];
    if (!origins.includes("BREAKOUT") || origins.includes("FLOW")) continue;
    setups[i] = mergeSameTickerDiscovery(s, flow);
    merged += 1;
  }
  return merged;
}

/** Map DB flow rows → deriveZeroDteSetups input (mirrors scan.ts). */
export function mapFlowRowsForCorroboration(
  flows: ReadonlyArray<{
    ticker: string;
    premium: number;
    option_type: string;
    strike: number;
    expiry: string;
    dte: number | null;
    alert_rule?: string | null;
    ask_pct?: number | null;
    underlying_price?: number | null;
    fill_price?: number | null;
    open_interest?: number | null;
    alerted_at?: string | null;
  }>
): Parameters<typeof deriveZeroDteSetups>[0] {
  return flows.map((f) => ({
    ticker: f.ticker,
    premium: f.premium,
    option_type: f.option_type,
    strike: f.strike,
    expiry: f.expiry,
    dte: f.dte,
    alert_rule: f.alert_rule,
    ask_pct: f.ask_pct,
    underlying_price: f.underlying_price,
    fill_price: f.fill_price,
    open_interest: f.open_interest,
    alerted_at: f.alerted_at,
  }));
}

/** Enrich corroborating FLOW setups without dossier (light pass — dossier still top-N). */
export function enrichCorroboratingFlowSetups(
  raw: ZeroDteSetup[],
  extrasByTicker?: Map<string, { earnings?: EarningsFlag | null; news_hot?: NewsHeat | null }>
): EnrichedZeroDteSetup[] {
  return raw.map((setup) => {
    const extras = extrasByTicker?.get(setup.ticker);
    return enrichSetup(setup, null, {
      earnings: extras?.earnings ?? null,
      news_hot: extras?.news_hot ?? null,
    });
  });
}
