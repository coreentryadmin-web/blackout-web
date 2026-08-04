/**
 * Admin 0DTE discovery funnel — aggregates zerodte_discovery_events + zerodte_scan_rejections
 * for AdminBieDashboard's funnel panel (Phase 2b). Read-only; no new instrumentation.
 */
import { dbConfigured, fetchZeroDteDiscoveryEvents, fetchZeroDteScanRejections } from "@/lib/db";
import { todayEt } from "@/features/nighthawk/lib/session";

const EVENTS_SAMPLE_LIMIT = 2000;
const REJECTIONS_SAMPLE_LIMIT = 500;

export type ZeroDteFunnelGateBucket = {
  gate: string;
  label: string;
  n: number;
};

export type ZeroDteFunnelRecentEvent = {
  observed_at: string;
  ticker: string;
  kind: string;
  gate_code: string | null;
  score: number | null;
  detail: string | null;
};

export type ZeroDteFunnelSnapshot = {
  generated_at: string;
  session_date: string;
  db_configured: boolean;
  /** Distinct tickers with a `detected` event today (discovery-events table). */
  detected_tickers: number;
  /** Rows with kind=gate_blocked today. */
  gate_blocked_events: number;
  /** Rows with kind=commit today. */
  commit_events: number;
  /** Throttled rejection rows today (scan_rejections table). */
  rejection_rows: number;
  /** Merged gate-code histogram for HorzBar chart. */
  by_gate: ZeroDteFunnelGateBucket[];
  /** Event kind counts (raw rows, not distinct tickers). */
  by_kind: Array<{ kind: string; n: number }>;
  recent_events: ZeroDteFunnelRecentEvent[];
  events_sample_capped: boolean;
  rejections_sample_capped: boolean;
  errors: string[];
};

const GATE_LABELS: Record<string, string> = {
  min_gross: "Min gross premium",
  min_aggr_share: "Aggression share",
  min_dominance: "Side dominance",
  max_itm_pct: "Max ITM",
  no_dominant_strike: "No dominant strike",
  score_floor: "Score floor (G-3)",
  cortex_veto: "Cortex veto",
  governor_session_stops: "Session governor",
  correlated_conflict: "Correlated conflict",
  halt_feed_stale: "Halt feed stale",
};

function gateLabel(code: string): string {
  if (GATE_LABELS[code]) return GATE_LABELS[code];
  if (code.startsWith("cortex_veto")) return "Cortex veto";
  if (code.startsWith("G-")) return code;
  return code.replace(/_/g, " ");
}

/** Pure aggregation — unit-tested without DB. */
export function aggregateZeroDteFunnel(input: {
  session_date: string;
  events: ReadonlyArray<{
    observed_at: string;
    ticker: string;
    kind: string;
    gate_code: string | null;
    score: number | null;
    detail: string | null;
  }>;
  rejections: ReadonlyArray<{ gate_failed: string }>;
  events_sample_capped: boolean;
  rejections_sample_capped: boolean;
}): Omit<ZeroDteFunnelSnapshot, "generated_at" | "db_configured" | "errors"> {
  const detectedTickers = new Set<string>();
  const kindCounts = new Map<string, number>();
  let gateBlockedEvents = 0;
  let commitEvents = 0;

  for (const e of input.events) {
    kindCounts.set(e.kind, (kindCounts.get(e.kind) ?? 0) + 1);
    if (e.kind === "detected") detectedTickers.add(e.ticker.toUpperCase());
    if (e.kind === "gate_blocked") gateBlockedEvents += 1;
    if (e.kind === "commit") commitEvents += 1;
  }

  const gateCounts = new Map<string, number>();
  for (const e of input.events) {
    if (e.kind === "gate_blocked" && e.gate_code) {
      gateCounts.set(e.gate_code, (gateCounts.get(e.gate_code) ?? 0) + 1);
    }
  }
  for (const r of input.rejections) {
    const g = r.gate_failed;
    if (g) gateCounts.set(g, (gateCounts.get(g) ?? 0) + 1);
  }

  const by_gate = [...gateCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([gate, n]) => ({ gate, label: gateLabel(gate), n }));

  const by_kind = [...kindCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, n]) => ({ kind, n }));

  const recent_events = input.events.slice(0, 24).map((e) => ({
    observed_at: e.observed_at,
    ticker: e.ticker,
    kind: e.kind,
    gate_code: e.gate_code,
    score: e.score,
    detail: e.detail,
  }));

  return {
    session_date: input.session_date,
    detected_tickers: detectedTickers.size,
    gate_blocked_events: gateBlockedEvents,
    commit_events: commitEvents,
    rejection_rows: input.rejections.length,
    by_gate,
    by_kind,
    recent_events,
    events_sample_capped: input.events_sample_capped,
    rejections_sample_capped: input.rejections_sample_capped,
  };
}

export async function fetchZeroDteFunnelSnapshot(sessionDate = todayEt()): Promise<ZeroDteFunnelSnapshot> {
  const errors: string[] = [];
  if (!dbConfigured()) {
    return {
      generated_at: new Date().toISOString(),
      session_date: sessionDate,
      db_configured: false,
      detected_tickers: 0,
      gate_blocked_events: 0,
      commit_events: 0,
      rejection_rows: 0,
      by_gate: [],
      by_kind: [],
      recent_events: [],
      events_sample_capped: false,
      rejections_sample_capped: false,
      errors: ["DATABASE_URL not configured"],
    };
  }

  let events: Awaited<ReturnType<typeof fetchZeroDteDiscoveryEvents>> = [];
  let rejections: Awaited<ReturnType<typeof fetchZeroDteScanRejections>> = [];
  let events_sample_capped = false;
  let rejections_sample_capped = false;

  try {
    events = await fetchZeroDteDiscoveryEvents({
      session_date: sessionDate,
      limit: EVENTS_SAMPLE_LIMIT,
    });
    events_sample_capped = events.length >= EVENTS_SAMPLE_LIMIT;
  } catch (e) {
    errors.push(`discovery_events: ${e instanceof Error ? e.message : "read failed"}`);
  }

  try {
    rejections = await fetchZeroDteScanRejections({
      session_date: sessionDate,
      limit: REJECTIONS_SAMPLE_LIMIT,
    });
    rejections_sample_capped = rejections.length >= REJECTIONS_SAMPLE_LIMIT;
  } catch (e) {
    errors.push(`scan_rejections: ${e instanceof Error ? e.message : "read failed"}`);
  }

  const core = aggregateZeroDteFunnel({
    session_date: sessionDate,
    events,
    rejections,
    events_sample_capped,
    rejections_sample_capped,
  });

  return {
    generated_at: new Date().toISOString(),
    db_configured: true,
    errors,
    ...core,
  };
}
