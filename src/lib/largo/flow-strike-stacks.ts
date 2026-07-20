/** UW Repeated Hits + same-strike accumulation — server-side, fed to Largo before Claude writes. */

import { fmtPremium as fmtFlowPremShort } from "@/lib/fmt-money";
import {
  HELIX_STRIKE_HITS_WINDOW_MS,
  HELIX_STRIKE_HITS_WINDOW_MIN,
  flowStackAlertTimeMs,
} from "@/features/helix/lib/helix-strike-leaders";

export { fmtFlowPremShort };

export type FlowAlertForStack = {
  ticker: string;
  strike: number;
  option_type: string;
  expiry: string;
  premium: number;
  alerted_at: string;
  event_at?: string | null;
  ask_pct?: number | null;
  alert_rule: string | null;
  trade_count: number | null;
};

export type FlowStrikeStack = {
  ticker: string;
  strike: number;
  option_type: string;
  expiry: string;
  alert_count: number;
  total_premium: number;
  premiums: number[];
  trade_count: number | null;
  repeated_hits: boolean;
  same_strike_accumulation: boolean;
  alert_rules: string[];
  kind: "repeated_hits" | "same_strike_stack" | "repeated_and_stacked";
  /** Hits inside the rolling window (when `windowMs` passed to compute). */
  recent_hit_count: number;
  recent_premium: number;
  hits_window_min: number;
  /** Weighted avg ask-side % when available — drives bought/sold copy. */
  avg_ask_pct: number | null;
};

const REPEATED_HIT_RULES = new Set([
  "RepeatedHits",
  "RepeatedHitsAscendingFill",
  "RepeatedHitsDescendingFill",
]);

export function isUwRepeatedHitsRule(rule: string | null | undefined): boolean {
  if (!rule) return false;
  if (REPEATED_HIT_RULES.has(rule)) return true;
  return rule.startsWith("RepeatedHits");
}

// Bug 6: normalize expiry to YYYY-MM-DD regardless of input format so stackKey is consistent
function normalizeExpiry(raw: string): string {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const usLong = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usLong) return `${usLong[3]}-${usLong[1].padStart(2, "0")}-${usLong[2].padStart(2, "0")}`;
  const usShort = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (usShort) return `20${usShort[3]}-${usShort[1].padStart(2, "0")}-${usShort[2].padStart(2, "0")}`;
  return raw.slice(0, 10);
}

export function normalizeFlowAlertForStack(item: unknown): FlowAlertForStack | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;

  const strike = Number(o.strike ?? o.strike_price ?? 0);
  const premium = Number(o.premium ?? o.total_premium ?? 0);
  if (!Number.isFinite(strike) || strike <= 0) return null;
  if (!Number.isFinite(premium) || premium <= 0) return null;

  // Parser-truth (gap #6): a typeless print must DROP, not default to CALL — defaulting
  // mis-stacked UNKNOWN prints onto the CALL side of STRIKE STACKS / NET PREMIUM. Take the
  // raw type only; if it doesn't resolve to a real call/put, return null and skip the row.
  const opt = String(o.option_type ?? o.type ?? o.side ?? o.put_call ?? "").toUpperCase();
  if (!opt.startsWith("C") && !opt.startsWith("P")) return null;
  const option_type = opt.startsWith("P") ? "PUT" : "CALL";

  let alerted_at = String(o.alerted_at ?? o.created_at ?? o.time ?? "");
  if (!alerted_at && o.start_time) {
    const ts = Number(o.start_time);
    if (Number.isFinite(ts)) alerted_at = new Date(ts > 1e12 ? ts : ts * 1000).toISOString();
  }

  const ruleRaw = String(o.alert_rule ?? o.rule_name ?? "").trim();
  const tradeRaw = Number(o.trade_count ?? 0);
  const eventAt = o.event_at != null ? String(o.event_at) : null;
  const askRaw = o.ask_pct ?? o.ask_side_pct;
  const askPct = askRaw != null && Number.isFinite(Number(askRaw)) ? Number(askRaw) : null;

  return {
    ticker: String(o.ticker ?? o.symbol ?? "").toUpperCase(),
    strike,
    option_type,
    expiry: normalizeExpiry(String(o.expiry ?? o.expiration ?? "")),
    premium,
    alerted_at,
    event_at: eventAt,
    ask_pct: askPct,
    alert_rule: ruleRaw || null,
    trade_count: Number.isFinite(tradeRaw) && tradeRaw > 0 ? tradeRaw : null,
  };
}

function avgAskPct(rows: FlowAlertForStack[]): number | null {
  let sum = 0;
  let w = 0;
  for (const r of rows) {
    if (r.ask_pct == null || !Number.isFinite(r.ask_pct)) continue;
    const weight = r.premium > 0 ? r.premium : 1;
    sum += r.ask_pct * weight;
    w += weight;
  }
  if (w <= 0) return null;
  return sum / w;
}

/** Human read on whether flow lifted offers or hit bids on this contract stack. */
export function flowStackSideLabel(
  option_type: string,
  avgAskPctVal: number | null
): { side: "bought" | "sold" | "mixed"; lean: string } {
  const isCall = option_type.toUpperCase() === "CALL";
  const leg = isCall ? "Call" : "Put";
  if (avgAskPctVal == null) return { side: "mixed", lean: `${leg} flow` };
  if (avgAskPctVal >= 60) return { side: "bought", lean: `${leg} · bought (at ask)` };
  if (avgAskPctVal <= 40) return { side: "sold", lean: `${leg} · sold (at bid)` };
  return { side: "mixed", lean: `${leg} · mixed` };
}

function stackKey(a: FlowAlertForStack): string {
  return `${a.ticker}|${a.strike}|${a.option_type}|${a.expiry}`;
}

export function computeFlowStrikeStacks(
  alerts: unknown[],
  opts?: { minAlerts?: number; limit?: number; windowMs?: number; nowMs?: number }
): FlowStrikeStack[] {
  const minAlerts = opts?.minAlerts ?? 2;
  const limit = opts?.limit ?? 10;
  const windowMs = opts?.windowMs ?? HELIX_STRIKE_HITS_WINDOW_MS;
  const nowMs = opts?.nowMs ?? Date.now();
  const hitsWindowMin = Math.round(windowMs / 60_000) || HELIX_STRIKE_HITS_WINDOW_MIN;
  // Bug 9: cap input to recent 500 alerts — beyond that stacks are stale anyway
  const input = alerts.length > 500 ? alerts.slice(0, 500) : alerts;
  const groups = new Map<string, FlowAlertForStack[]>();

  for (const raw of input) {
    const row = normalizeFlowAlertForStack(raw);
    if (!row) continue;
    const key = stackKey(row);
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const stacks: FlowStrikeStack[] = [];

  for (const rows of Array.from(groups.values())) {
    const sorted = [...rows].sort(
      (a, b) => new Date(b.alerted_at || 0).getTime() - new Date(a.alerted_at || 0).getTime()
    );
    const premiums = sorted.map((r) => r.premium);
    const alert_rules = Array.from(
      new Set(sorted.map((r) => r.alert_rule).filter((r): r is string => Boolean(r)))
    );
    const repeated_hits = sorted.some(
      (r) => isUwRepeatedHitsRule(r.alert_rule) || (r.trade_count != null && r.trade_count >= 5)
    );
    const same_strike_accumulation = sorted.length >= minAlerts;
    if (!repeated_hits && !same_strike_accumulation) continue;

    const tradeSum = sorted.reduce((s, r) => s + (r.trade_count ?? 0), 0);
    const kind: FlowStrikeStack["kind"] =
      repeated_hits && same_strike_accumulation
        ? "repeated_and_stacked"
        : repeated_hits
          ? "repeated_hits"
          : "same_strike_stack";

    const recentRows = sorted.filter((r) => {
      const ms = flowStackAlertTimeMs(r);
      return ms != null && nowMs - ms <= windowMs;
    });
    const recentPremiums = recentRows.map((r) => r.premium);

    stacks.push({
      ticker: sorted[0].ticker,
      strike: sorted[0].strike,
      option_type: sorted[0].option_type,
      expiry: sorted[0].expiry,
      alert_count: sorted.length,
      total_premium: premiums.reduce((s, p) => s + p, 0),
      premiums,
      trade_count: tradeSum > 0 ? tradeSum : null,
      repeated_hits,
      same_strike_accumulation,
      alert_rules,
      kind,
      recent_hit_count: recentRows.length,
      recent_premium: recentPremiums.reduce((s, p) => s + p, 0),
      hits_window_min: hitsWindowMin,
      avg_ask_pct: avgAskPct(sorted),
    });
  }

  return stacks
    .sort(
      (a, b) =>
        b.recent_premium - a.recent_premium ||
        b.recent_hit_count - a.recent_hit_count ||
        b.total_premium - a.total_premium
    )
    .slice(0, limit);
}

export function formatFlowStrikeStackLine(stack: FlowStrikeStack): string {
  const exp = stack.expiry ? ` ${stack.expiry}` : "";
  const premParts = stack.premiums.map(fmtFlowPremShort).join(" + ");
  const rules =
    stack.alert_rules.length > 0
      ? stack.alert_rules.join(", ")
      : stack.repeated_hits
        ? "RepeatedHits (inferred)"
        : "—";
  const trades = stack.trade_count != null ? ` · ${stack.trade_count} UW fills` : "";
  const kind =
    stack.kind === "repeated_and_stacked"
      ? "Repeated Hits + multi-alert stack"
      : stack.kind === "repeated_hits"
        ? "UW Repeated Hits"
        : "Same-strike accumulation";

  return (
    `${stack.ticker} ${stack.option_type} @${stack.strike}${exp} — ` +
    `${stack.recent_hit_count > 0 ? `${stack.recent_hit_count} hits/${stack.hits_window_min}m · ` : ""}` +
    `${stack.alert_count} alert${stack.alert_count === 1 ? "" : "s"} · ` +
    `${fmtFlowPremShort(stack.total_premium)} total (${premParts}) · ` +
    `${kind} · rules: ${rules}${trades}`
  );
}

export function formatFlowStrikeStacksSection(stacks: FlowStrikeStack[]): string[] {
  if (!stacks.length) return [];
  return [
    "**Strike stacks / Repeated Hits (UW — call these out in Flow when relevant):**",
    ...stacks.slice(0, 8).map((s) => `- ${formatFlowStrikeStackLine(s)}`),
  ];
}

export function flowStackSignature(stacks: FlowStrikeStack[] | undefined): string {
  return (stacks ?? [])
    .map(
      (s) =>
        `${s.strike}|${s.option_type}|${s.expiry}|${s.alert_count}|${Math.round(s.total_premium)}`
    )
    .join(";");
}

export function withStrikeStacks<T extends Record<string, unknown>>(
  payload: T,
  alertSources: unknown[][]
): T & { strike_stacks: FlowStrikeStack[] } {
  const strike_stacks = computeFlowStrikeStacks(alertSources.flat());
  return { ...payload, strike_stacks };
}
