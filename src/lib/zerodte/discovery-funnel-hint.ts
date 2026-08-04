/**
 * Member-facing discovery funnel hint (Phase 2c) — top rejection reason for the session strip.
 * Read-only aggregation over discovery events + scan rejections; no new instrumentation.
 */
import { aggregateZeroDteFunnel } from "@/lib/admin-zerodte-funnel";

export type DiscoveryFunnelHint = {
  /** Distinct tickers detected today. */
  detected_tickers: number;
  /** Gate-blocked event count today. */
  gate_blocked_events: number;
  /** Commits today (discovery events). */
  commit_events: number;
  /** Top gate code by frequency (merged events + rejections). */
  top_gate: string | null;
  top_gate_label: string | null;
  top_gate_n: number;
  /** Human one-liner for the session strip. */
  summary: string | null;
};

/** Pure: derive the member strip hint from funnel aggregation output. */
export function buildDiscoveryFunnelHint(
  agg: Pick<
    ReturnType<typeof aggregateZeroDteFunnel>,
    "detected_tickers" | "gate_blocked_events" | "commit_events" | "by_gate"
  >
): DiscoveryFunnelHint {
  const top = agg.by_gate[0] ?? null;
  let summary: string | null = null;
  if (top && top.n > 0) {
    summary = `Top gate today: ${top.label} (${top.n})`;
  } else if (agg.detected_tickers > 0 && agg.commit_events === 0) {
    summary = `${agg.detected_tickers} detected · 0 commits yet`;
  } else if (agg.detected_tickers === 0) {
    summary = null;
  } else {
    summary = `${agg.detected_tickers} detected · ${agg.commit_events} committed`;
  }

  return {
    detected_tickers: agg.detected_tickers,
    gate_blocked_events: agg.gate_blocked_events,
    commit_events: agg.commit_events,
    top_gate: top?.gate ?? null,
    top_gate_label: top?.label ?? null,
    top_gate_n: top?.n ?? 0,
    summary,
  };
}

/** Best-effort session funnel hint for the member board strip. */
export async function fetchDiscoveryFunnelHint(sessionDate: string): Promise<DiscoveryFunnelHint | null> {
  const { dbConfigured, fetchZeroDteDiscoveryEvents, fetchZeroDteScanRejections } = await import("@/lib/db");
  if (!dbConfigured()) return null;
  try {
    const [events, rejections] = await Promise.all([
      fetchZeroDteDiscoveryEvents({ session_date: sessionDate, limit: 500 }),
      fetchZeroDteScanRejections({ session_date: sessionDate, limit: 200 }),
    ]);
    const agg = aggregateZeroDteFunnel({
      session_date: sessionDate,
      events,
      rejections,
      events_sample_capped: events.length >= 500,
      rejections_sample_capped: rejections.length >= 200,
    });
    return buildDiscoveryFunnelHint(agg);
  } catch {
    return null;
  }
}
