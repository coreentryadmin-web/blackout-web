import { flowEventTimeMs } from "@/lib/flow-timestamp";
import {
  directionLabel,
  directionalPremium,
  type DirectionalPremium,
} from "@/features/helix/lib/helix-flow-aggression";

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
  /** Ask-side share of premium (0-100). Required for the DIRECTION read — without it every
   *  print is `undetermined`, which is honest but useless, so every caller must pass it.
   *  All three do: `fetchRecentFlows` selects it (db.ts `AS ask_pct`), and the client and Largo
   *  paths both carry full `FlowAlert` rows. */
  ask_pct?: number | null;
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
  /**
   * What the flow says about the UNDERLYING, from option type × aggressor side — not from the
   * call/put premium split, which cannot tell a bought call from a sold one. See
   * `helix-flow-aggression.ts` for the measurement: the two rules SIGN-FLIP on 44.6% of tickers,
   * and this value is persisted and GRADED, so the old rule was scoring inverted predictions.
   *
   * `undetermined` when the aggressor side is unknown for most of the premium. It is not folded
   * into "mixed", which means "read successfully, and genuinely two-sided".
   */
  direction: "bullish" | "bearish" | "mixed" | "undetermined";
  /** The premium behind `direction`, so a consumer can see what the label rests on. */
  directional: DirectionalPremium;
};

const SPLIT_WINDOW_MS = 30 * 60 * 1000;
const SPLIT_MIN_LEG = 500_000;

/** Opposing call+put flow (>= $500K each leg) within a 30-min window, per ticker. */
export function detectSplitFlow(flows: MinimalFlow[], nowMs: number): SplitFlowEntry[] {
  // DETECTION IS UNCHANGED. What fires, and when, is exactly what it was: opposing call AND put
  // premium above the same leg threshold inside the same window. Only the DIRECTION this reports
  // changed — deliberately, because the firing is a persisted, graded row and altering when it
  // fires would break continuity of the record on top of correcting its label.
  const byTicker = new Map<string, { callPrem: number; putPrem: number; rows: MinimalFlow[] }>();

  for (const alert of flows) {
    const ms = flowEventTimeMs(alert);
    if (ms == null || nowMs - ms > SPLIT_WINDOW_MS) continue;
    const cur = byTicker.get(alert.ticker) ?? { callPrem: 0, putPrem: 0, rows: [] };
    if (alert.option_type === "CALL") cur.callPrem += alert.premium;
    else if (alert.option_type === "PUT") cur.putPrem += alert.premium;
    cur.rows.push(alert);
    byTicker.set(alert.ticker, cur);
  }

  const result: SplitFlowEntry[] = [];
  for (const [ticker, { callPrem, putPrem, rows }] of Array.from(byTicker)) {
    if (callPrem >= SPLIT_MIN_LEG && putPrem >= SPLIT_MIN_LEG) {
      const total = callPrem + putPrem;
      const callPct = Math.round((callPrem / total) * 100);
      const directional = directionalPremium(rows);
      result.push({
        ticker,
        callPremium: callPrem,
        putPremium: putPrem,
        callPct,
        total,
        direction: directionLabel(directional),
        directional,
      });
    }
  }
  return result.sort((a, b) => b.total - a.total);
}
