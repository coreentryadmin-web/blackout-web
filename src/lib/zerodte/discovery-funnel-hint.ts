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

/**
 * Best-effort session funnel hint for the member board strip.
 *
 * SUPPLIES THE EXACT COUNTS. `aggregateZeroDteFunnel` counts kinds INSIDE its sample window and
 * `exactOr` prefers a true aggregate when one is passed. #2402 wired that for the ADMIN funnel and
 * this member path — a second caller of the same aggregator — was left passing nothing, so it fell
 * back to the sample on every field. It is the surface MEMBERS see; admin is internal.
 *
 * MEASURED ON PROD 2026-08-20 at 20:17Z, both read at the same instant, AFTER #2402 deployed:
 *
 *                          board     admin    truth
 *     commit_events            0         7    7 ledger rows
 *     gate_blocked_events    305     3,239
 *     detected_tickers        47       157
 *
 * The board understated commits to ZERO and gate-blocks by 10.6x. The mechanism is the newest-N
 * window: with 3,239 gate-blocked events, the newest 500 are all late-session blocks, so the 7
 * commits (14:08-14:44Z) fall outside the window entirely and read as "nothing committed today"
 * on a day that committed seven plays and halted the governor on six losers.
 *
 * The sample stays at 500/200 — it still feeds `by_gate` ranking and the capped flags, which are
 * about the DISTRIBUTION and are fine sampled. Only the totals move to exact.
 */
export async function fetchDiscoveryFunnelHint(sessionDate: string): Promise<DiscoveryFunnelHint | null> {
  const {
    dbConfigured,
    fetchZeroDteDiscoveryEvents,
    fetchZeroDteScanRejections,
    countZeroDteDiscoveryEventsByKind,
    countZeroDteDetectedTickers,
  } = await import("@/lib/db");
  if (!dbConfigured()) return null;
  try {
    const [events, rejections] = await Promise.all([
      fetchZeroDteDiscoveryEvents({ session_date: sessionDate, limit: 500 }),
      fetchZeroDteScanRejections({ session_date: sessionDate, limit: 200 }),
    ]);
    // Best-effort, INDEPENDENTLY of each other and of the samples above: an exact-count query that
    // fails must degrade to the sampled number for that field alone, not take down the whole strip.
    // `?? null` (not `|| null`) so a legitimate exact ZERO survives — the same distinction
    // `exactOr` relies on downstream.
    const [exactKinds, exactDetected] = await Promise.all([
      countZeroDteDiscoveryEventsByKind(sessionDate).catch(() => null),
      countZeroDteDetectedTickers(sessionDate).catch(() => null),
    ]);
    const agg = aggregateZeroDteFunnel({
      session_date: sessionDate,
      events,
      rejections,
      events_sample_capped: events.length >= 500,
      rejections_sample_capped: rejections.length >= 200,
      exact_kind_counts: exactKinds ?? null,
      exact_detected_tickers: exactDetected ?? null,
    });
    return buildDiscoveryFunnelHint(agg);
  } catch {
    return null;
  }
}
