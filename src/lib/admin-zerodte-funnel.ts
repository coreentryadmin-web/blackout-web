/**
 * Admin 0DTE discovery funnel — aggregates zerodte_discovery_events + zerodte_scan_rejections
 * for AdminBieDashboard's funnel panel (Phase 2b). Read-only; no new instrumentation.
 *
 * `raw_events`/`raw_rejections` (added for the veto-flicker-rate probe, INTENTIONAL-DESIGN #2 —
 * see docs/audit/FINDINGS.md 2026-08-05) are the same rows `recent_events`/`by_gate` already
 * summarize, just unaggregated and uncapped-at-24 — the exact per-ticker, per-timestamp state
 * transitions `scripts/audit/veto-flicker-rate.mjs` needs to reconstruct a session's Cortex
 * veto series (gate_blocked cortex_veto* events = vetoed, detected/commit/other-gate events =
 * not vetoed by Cortex that state). Purely additive to the existing response shape; no new
 * instrumentation, no write path touched.
 */
import {
  countZeroDteDetectedTickers,
  countZeroDteDiscoveryEventsByKind,
  dbConfigured,
  fetchZeroDteDiscoveryEvents,
  fetchZeroDteScanRejections,
} from "@/lib/db";
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

/** One uncapped discovery-event row (see module doc) — direction is pulled out of
 *  the JSONB `payload` where present (detected/gate_blocked/commit all stash it there). */
export type ZeroDteFunnelRawEvent = {
  observed_at: string;
  ticker: string;
  kind: string;
  gate_code: string | null;
  direction: string | null;
  score: number | null;
};

/** One uncapped scan-rejection row (see module doc) — carries first_seen/last_seen,
 *  the state-persistence window a throttled rejection row represents. */
export type ZeroDteFunnelRawRejection = {
  observed_at: string;
  ticker: string;
  gate_failed: string;
  direction: string | null;
  first_seen: string | null;
  last_seen: string | null;
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
  /** Uncapped-at-24 discovery events for this session (bounded only by
   *  EVENTS_SAMPLE_LIMIT, same rows `by_gate`/`by_kind` were computed from) — see
   *  module doc. */
  raw_events: ZeroDteFunnelRawEvent[];
  /** Uncapped scan-rejection rows for this session (bounded only by
   *  REJECTIONS_SAMPLE_LIMIT) — see module doc. */
  raw_rejections: ZeroDteFunnelRawRejection[];
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
    /** JSONB payload — detected/gate_blocked/commit all stash `direction` here.
     *  Optional so existing call sites/tests that omit it keep compiling. */
    payload?: Record<string, unknown> | null;
  }>;
  rejections: ReadonlyArray<{
    gate_failed: string;
    observed_at?: string;
    ticker?: string;
    direction?: string | null;
    first_seen?: string | null;
    last_seen?: string | null;
  }>;
  events_sample_capped: boolean;
  rejections_sample_capped: boolean;
  /**
   * EXACT session totals from a `GROUP BY`, when available. Optional so every existing caller and
   * test keeps working on the sampled path; when present they WIN, because a total derived from a
   * capped window is not a total.
   */
  exact_kind_counts?: Record<string, number> | null;
  exact_detected_tickers?: number | null;
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

  // Uncapped-at-24 mirrors of the same two rows sets (see module doc) — ordered
  // oldest-first (the fetch layer reads DESC for `recent_events`; a pass-series
  // reconstruction wants chronological order), direction pulled out of `payload`.
  const raw_events: ZeroDteFunnelRawEvent[] = [...input.events]
    .reverse()
    .map((e) => ({
      observed_at: e.observed_at,
      ticker: e.ticker,
      kind: e.kind,
      gate_code: e.gate_code,
      direction:
        e.payload && typeof e.payload.direction === "string" ? (e.payload.direction as string) : null,
      score: e.score,
    }));

  const raw_rejections: ZeroDteFunnelRawRejection[] = [...input.rejections]
    .reverse()
    .map((r) => ({
      observed_at: r.observed_at ?? "",
      ticker: r.ticker ?? "",
      gate_failed: r.gate_failed,
      direction: r.direction ?? null,
      first_seen: r.first_seen ?? null,
      last_seen: r.last_seen ?? null,
    }));

  // Prefer the exact aggregate; fall back to the sampled count only when the query failed.
  // `?? undefined` (not `||`) so a legitimate exact ZERO is not replaced by a sampled non-zero.
  const exact = input.exact_kind_counts ?? null;
  const exactOr = (kind: string, sampled: number) => exact?.[kind] ?? sampled;

  return {
    session_date: input.session_date,
    detected_tickers: input.exact_detected_tickers ?? detectedTickers.size,
    gate_blocked_events: exactOr("gate_blocked", gateBlockedEvents),
    commit_events: exactOr("commit", commitEvents),
    rejection_rows: input.rejections.length,
    by_gate,
    by_kind,
    recent_events,
    events_sample_capped: input.events_sample_capped,
    rejections_sample_capped: input.rejections_sample_capped,
    raw_events,
    raw_rejections,
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
      raw_events: [],
      raw_rejections: [],
      errors: ["DATABASE_URL not configured"],
    };
  }

  let events: Awaited<ReturnType<typeof fetchZeroDteDiscoveryEvents>> = [];
  let rejections: Awaited<ReturnType<typeof fetchZeroDteScanRejections>> = [];
  let events_sample_capped = false;
  let rejections_sample_capped = false;
  /** Exact per-kind totals; null when the count query failed and we fall back to the sample. */
  let kindCounts: Record<string, number> | null = null;
  let detectedTickerCount: number | null = null;

  try {
    events = await fetchZeroDteDiscoveryEvents({
      session_date: sessionDate,
      limit: EVENTS_SAMPLE_LIMIT,
    });
    events_sample_capped = events.length >= EVENTS_SAMPLE_LIMIT;
    // EXACT counts, independent of the sample above.
    //
    // The sample exists to power `recent_events` / `by_gate` / `raw_events`, which are inherently
    // "latest N" views. The FUNNEL TOTALS are not — they are claims about the whole session, and
    // deriving them from a saturated window silently understates them. Fetched here so a failure
    // degrades to the old sampled numbers rather than blanking the funnel.
    try {
      kindCounts = await countZeroDteDiscoveryEventsByKind(sessionDate);
      detectedTickerCount = await countZeroDteDetectedTickers(sessionDate);
    } catch (e) {
      errors.push(`discovery_event_counts: ${e instanceof Error ? e.message : "count failed"}`);
    }
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
    exact_kind_counts: kindCounts,
    exact_detected_tickers: detectedTickerCount,
  });

  return {
    generated_at: new Date().toISOString(),
    db_configured: true,
    errors,
    ...core,
  };
}
