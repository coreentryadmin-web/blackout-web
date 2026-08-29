/**
 * Flow campaign clustering — groups nearby prints on the same ticker/side within a short
 * window so coordinated multi-fill activity reads as one campaign, not noise.
 */
import type { FlowAlert } from "@/lib/api";
import { flowEventTimeMs } from "@/lib/flow-timestamp";
import { flowContractKey } from "@/lib/helix/contract-identity";

export const HELIX_FLOW_CLUSTER_WINDOW_MS = 5 * 60 * 1000;
export const HELIX_FLOW_CLUSTER_MIN_SIZE = 2;
export const HELIX_FLOW_CLUSTER_STRIKE_TOL_PCT = 0.02;

export type HelixFlowCluster = {
  id: string;
  ticker: string;
  side: "call" | "put";
  /** Representative strike (premium-weighted). */
  strike: number;
  expiry: string;
  printCount: number;
  totalPremium: number;
  firstAt: string;
  lastAt: string;
  avgAskPct: number | null;
  alertRules: string[];
};

function sideOf(flow: FlowAlert): "call" | "put" | null {
  const t = flow.option_type?.toUpperCase();
  if (t === "CALL" || t?.startsWith("C")) return "call";
  if (t === "PUT" || t?.startsWith("P")) return "put";
  return null;
}

function strikesNear(a: number, b: number, refSpot: number | null): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === b) return true;
  const ref = refSpot != null && refSpot > 0 ? refSpot : Math.max(a, b);
  return Math.abs(a - b) / ref <= HELIX_FLOW_CLUSTER_STRIKE_TOL_PCT;
}

function mergeRules(existing: string[], rule: string | null | undefined): string[] {
  if (!rule?.trim()) return existing;
  const r = rule.trim();
  return existing.includes(r) ? existing : [...existing, r];
}

/** Cluster visible tape prints; singletons omitted unless minSize=1. */
export function clusterFlowPrints(
  alerts: readonly FlowAlert[],
  opts?: {
    windowMs?: number;
    minSize?: number;
    limit?: number;
  }
): HelixFlowCluster[] {
  const windowMs = opts?.windowMs ?? HELIX_FLOW_CLUSTER_WINDOW_MS;
  const minSize = opts?.minSize ?? HELIX_FLOW_CLUSTER_MIN_SIZE;
  const limit = opts?.limit ?? 12;

  type Mutable = HelixFlowCluster & { _lastMs: number; _askSum: number; _askN: number };
  const clusters: Mutable[] = [];

  const sorted = [...alerts].sort((a, b) => {
    const am = flowEventTimeMs(a) ?? 0;
    const bm = flowEventTimeMs(b) ?? 0;
    return am - bm;
  });

  for (const a of sorted) {
    const side = sideOf(a);
    const ms = flowEventTimeMs(a);
    if (!side || ms == null) continue;
    const ticker = a.ticker.toUpperCase();
    const spot = a.underlying_price ?? null;

    let merged: Mutable | null = null;
    for (const c of clusters) {
      if (c.ticker !== ticker || c.side !== side) continue;
      if (c.expiry !== a.expiry) continue;
      if (!strikesNear(c.strike, a.strike, spot)) continue;
      if (ms - c._lastMs > windowMs) continue;
      merged = c;
      break;
    }

    const alerted = a.alerted_at || a.event_at || "";
    if (!merged) {
      clusters.push({
        id: flowContractKey(a) ?? `${ticker}-${side}-${a.strike}-${a.expiry}-${ms}`,
        ticker,
        side,
        strike: a.strike,
        expiry: a.expiry,
        printCount: 1,
        totalPremium: a.premium ?? 0,
        firstAt: alerted,
        lastAt: alerted,
        avgAskPct: a.ask_pct ?? null,
        alertRules: a.alert_rule ? [a.alert_rule] : [],
        _lastMs: ms,
        _askSum: a.ask_pct ?? 0,
        _askN: a.ask_pct != null ? 1 : 0,
      });
      continue;
    }

    merged.printCount += 1;
    merged.totalPremium += a.premium ?? 0;
    merged.lastAt = alerted || merged.lastAt;
    merged._lastMs = ms;
    merged.strike =
      merged.totalPremium > 0
        ? (merged.strike * (merged.totalPremium - (a.premium ?? 0)) + a.strike * (a.premium ?? 0)) /
          merged.totalPremium
        : merged.strike;
    if (a.ask_pct != null) {
      merged._askSum += a.ask_pct;
      merged._askN += 1;
    }
    merged.avgAskPct = merged._askN > 0 ? merged._askSum / merged._askN : null;
    merged.alertRules = mergeRules(merged.alertRules, a.alert_rule);
  }

  return clusters
    .filter((c) => c.printCount >= minSize)
    .map(({ _lastMs, _askSum, _askN, ...rest }) => rest)
    .sort((a, b) => b.totalPremium - a.totalPremium)
    .slice(0, limit);
}
