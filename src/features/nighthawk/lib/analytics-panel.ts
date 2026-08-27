// Pure aggregation for the 0DTE Command "Session Analytics" panel
// (NighthawkAnalyticsPanel.tsx). The API (`/api/market/zerodte/record`) already ships
// by_outcome/by_direction/by_score_band rollups (record.ts) — this module adds the two
// breakdowns the wire format does NOT compute (by merit tier, and a same-session
// cumulative P&L curve), from the SAME `plays[]` array the record response already
// carries. No new endpoint, no invented numbers: every input here is a field already
// on ZeroDteRecordPlay.
//
// Kept separate from the component so the aggregation math is unit-testable without a
// DOM/SWR/recharts import — same split as record.ts itself (route fetches, this shapes).

import type { ZeroDteRecordPlay } from "@/lib/zerodte/record";
import { LOW_N_THRESHOLD } from "@/lib/zerodte/record";
import type { ZeroDteTier } from "@/lib/zerodte/tiers";

export type TierWinRateBucket = {
  tier: ZeroDteTier;
  n: number;
  wins: number;
  losses: number;
  breakeven: number;
  win_rate_pct: number | null;
  avg_pnl_pct: number | null;
  low_n: boolean;
};

const TIER_ORDER: ZeroDteTier[] = ["A", "B", "C"];

/** Only rows with a real as-managed grade count — mirrors record.ts's own
 *  win/loss/breakeven partition (a null managed_outcome is ungraded, not a loss). */
function isGraded(p: ZeroDteRecordPlay): boolean {
  return p.managed_outcome != null && p.managed_pnl_pct != null;
}

function isWin(p: ZeroDteRecordPlay): boolean {
  return (p.managed_pnl_pct ?? 0) > 0;
}

function isLoss(p: ZeroDteRecordPlay): boolean {
  return (p.managed_pnl_pct ?? 0) < 0;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Win rate broken out by the pinned commit-time merit tier (A/B/C — same field the
 * board's TierChip renders). Untiered rows (pre-context plays, `tier: null`) are
 * dropped rather than bucketed as a 4th "untiered" group — that reads as a real tier
 * to a scanning trader, which it is not. Always returns all 3 known tiers (n=0 buckets
 * included) so the panel can show "no A-tier plays yet" rather than silently omitting
 * a row of the table.
 */
export function winRateByTier(plays: ZeroDteRecordPlay[]): TierWinRateBucket[] {
  const buckets = new Map<ZeroDteTier, ZeroDteRecordPlay[]>(TIER_ORDER.map((t) => [t, []]));
  for (const p of plays) {
    if (!isGraded(p) || !p.tier) continue;
    buckets.get(p.tier)?.push(p);
  }
  return TIER_ORDER.map((tier) => {
    const rows = buckets.get(tier) ?? [];
    const wins = rows.filter(isWin).length;
    const losses = rows.filter(isLoss).length;
    const breakeven = rows.length - wins - losses;
    const decided = wins + losses + breakeven;
    const sum = rows.reduce((acc, r) => acc + (r.managed_pnl_pct ?? 0), 0);
    return {
      tier,
      n: rows.length,
      wins,
      losses,
      breakeven,
      win_rate_pct: decided > 0 ? round1((wins / decided) * 100) : null,
      avg_pnl_pct: rows.length > 0 ? round1(sum / rows.length) : null,
      low_n: rows.length < LOW_N_THRESHOLD,
    };
  });
}

export type PnlCurvePoint = {
  /** 1-based sequence within the session, for the chart's x-axis. */
  seq: number;
  ticker: string;
  /** This play's own realized return. */
  pnl_pct: number;
  /** Running sum of pnl_pct across the session so far (equal-weight — no sizing model
   *  exists at this layer, so this is a SHAPE indicator: is the session net green or
   *  red as plays resolve, not a dollar P&L). */
  cumulative_pct: number;
};

/**
 * Same-session cumulative P&L shape: every GRADED play from the most recent session
 * date present in `plays`, in flagged order, with a running sum of managed_pnl_pct.
 * Equal-weighted by construction (this layer has no position-sizing model) — labeled
 * as such in the panel, never presented as a dollar curve.
 *
 * Returns [] when there is no graded play for the latest session yet (pre-market, or a
 * session with zero resolved outcomes so far) — the panel shows its own empty state
 * rather than a chart of nothing.
 */
export function sessionPnlCurve(plays: ZeroDteRecordPlay[]): PnlCurvePoint[] {
  if (plays.length === 0) return [];
  const latestDate = plays.reduce(
    (max, p) => (p.session_date > max ? p.session_date : max),
    plays[0].session_date
  );
  const sessionRows = plays
    .filter((p) => p.session_date === latestDate && isGraded(p))
    .sort((a, b) => Date.parse(a.flagged_at) - Date.parse(b.flagged_at));

  let running = 0;
  return sessionRows.map((p, i) => {
    running += p.managed_pnl_pct ?? 0;
    return {
      seq: i + 1,
      ticker: p.ticker,
      pnl_pct: round1(p.managed_pnl_pct ?? 0),
      cumulative_pct: round1(running),
    };
  });
}
