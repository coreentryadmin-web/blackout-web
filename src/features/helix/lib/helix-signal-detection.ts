import { flowEventTimeMs } from "@/lib/flow-timestamp";

/**
 * Shared, framework-free detection logic for Helix's two persistable tape signals
 * (velocity spike, split flow). Extracted from FlowFeed.tsx's own useMemo blocks
 * (2026-08-02 Helix audit, Tier 2 item #9) so the client's live badges and the
 * server cron that persists signal firings for outcome grading can NEVER drift
 * into disagreeing about what counts as a spike/split — there is exactly one
 * definition, imported by both.
 *
 * "Coordinated" (dark-pool block + options sweep within 5min) is deliberately NOT
 * included here: it depends on a live UW dark-pool fetch (fetchDarkPoolPrints),
 * not a DB-backed table, so persisting it from a background cron would add a live
 * external-API dependency to a scheduled job. Tracked as an explicit, logged
 * follow-up (docs/audit/FINDINGS.md) rather than silently dropped.
 */

export type MinimalFlow = {
  ticker: string;
  option_type?: string | null;
  premium: number;
  event_at?: string | null;
  alerted_at?: string | null;
  tape_time_estimated?: boolean;
};

export type VelocitySpike = {
  ticker: string;
  recent: number;
  prior: number;
  ratio: number;
  recentPremium: number;
};

const VELOCITY_RECENT_WINDOW_MS = 15 * 60 * 1000;
const VELOCITY_PRIOR_WINDOW_MS = 30 * 60 * 1000;
const VELOCITY_MIN_RECENT = 2;
const VELOCITY_MIN_RATIO = 3;

/** Prints-per-15min vs the prior 15min window, per ticker. `nowMs` is injected (not
 *  Date.now()) so the server cron and any test can pin a deterministic clock. */
export function detectVelocitySpikes(flows: MinimalFlow[], nowMs: number): VelocitySpike[] {
  const byTicker = new Map<string, { recent: number; prior: number; recentPremium: number }>();

  for (const alert of flows) {
    if (!alert.event_at) continue;
    const age = nowMs - new Date(alert.event_at).getTime();
    if (!Number.isFinite(age)) continue;
    const cur = byTicker.get(alert.ticker) ?? { recent: 0, prior: 0, recentPremium: 0 };
    if (age <= VELOCITY_RECENT_WINDOW_MS) {
      cur.recent++;
      cur.recentPremium += alert.premium;
    } else if (age <= VELOCITY_PRIOR_WINDOW_MS) {
      cur.prior++;
    }
    byTicker.set(alert.ticker, cur);
  }

  const spikes: VelocitySpike[] = [];
  for (const [ticker, { recent, prior, recentPremium }] of Array.from(byTicker)) {
    const ratio = recent / Math.max(1, prior);
    if (recent >= VELOCITY_MIN_RECENT && ratio >= VELOCITY_MIN_RATIO) {
      spikes.push({ ticker, recent, prior, ratio, recentPremium });
    }
  }
  spikes.sort((a, b) => b.ratio - a.ratio);
  return spikes;
}

export type SplitFlowEntry = {
  ticker: string;
  callPremium: number;
  putPremium: number;
  callPct: number;
  total: number;
  direction: "bullish" | "bearish" | "mixed";
};

const SPLIT_WINDOW_MS = 30 * 60 * 1000;
const SPLIT_MIN_LEG = 500_000;

/** Opposing call+put flow (>= $500K each leg) within a 30-min window, per ticker. */
export function detectSplitFlow(flows: MinimalFlow[], nowMs: number): SplitFlowEntry[] {
  const byTicker = new Map<string, { callPrem: number; putPrem: number }>();

  for (const alert of flows) {
    const ms = flowEventTimeMs(alert);
    if (ms == null || nowMs - ms > SPLIT_WINDOW_MS) continue;
    const cur = byTicker.get(alert.ticker) ?? { callPrem: 0, putPrem: 0 };
    if (alert.option_type === "CALL") cur.callPrem += alert.premium;
    else if (alert.option_type === "PUT") cur.putPrem += alert.premium;
    byTicker.set(alert.ticker, cur);
  }

  const result: SplitFlowEntry[] = [];
  for (const [ticker, { callPrem, putPrem }] of Array.from(byTicker)) {
    if (callPrem >= SPLIT_MIN_LEG && putPrem >= SPLIT_MIN_LEG) {
      const total = callPrem + putPrem;
      const callPct = Math.round((callPrem / total) * 100);
      result.push({
        ticker,
        callPremium: callPrem,
        putPremium: putPrem,
        callPct,
        total,
        direction: callPct >= 60 ? "bullish" : callPct <= 40 ? "bearish" : "mixed",
      });
    }
  }
  return result.sort((a, b) => b.total - a.total);
}
