/**
 * Prefetched facts for social / X content asks — winners, board P&L, SPX snapshot, record.
 */

import { helixThermalCompareForLargo } from "@/lib/largo/helix-thermal-compare";
import {
  buildPostAngles,
  detectSocialArchetype,
  type SocialContentArchetype,
  type SocialContentPlayRow,
} from "@/lib/largo/social-content-core";
import { zerodteRecordForLargo } from "@/lib/largo/product-reads";
import { roundFloats } from "@/lib/round-floats";
import { zeroDtePlaysForLargo } from "@/lib/platform/zerodte-service";

export type { SocialContentArchetype, SocialContentPlayRow } from "@/lib/largo/social-content-core";
export { detectSocialArchetype, buildPostAngles } from "@/lib/largo/social-content-core";

export type SocialContentPack = {
  available: boolean;
  archetype: SocialContentArchetype;
  as_of: string;
  ticker_focus: string | null;
  winners: SocialContentPlayRow[];
  losers: SocialContentPlayRow[];
  board: {
    open_count: number;
    closed_today: number;
    best_winner_pct: number | null;
    worst_loser_pct: number | null;
  };
  spx: {
    spot: number | null;
    flip: number | null;
    gamma_regime: string | null;
    helix_bias: string | null;
    thermal_bias: string | null;
    conflict: boolean;
  } | null;
  record_7d: {
    wins: number;
    losses: number;
    win_rate_pct: number | null;
    sample_size: number;
  } | null;
  post_angles: string[];
};

function parsePnl(play: Record<string, unknown>): number | null {
  const v =
    play.live_pnl_pct ??
    play.pnl_pct ??
    play.graded_pnl_pct ??
    play.realized_pnl_pct;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapPlay(play: Record<string, unknown>): SocialContentPlayRow {
  return {
    ticker: String(play.ticker ?? "").toUpperCase(),
    direction: play.direction != null ? String(play.direction) : null,
    status: play.status != null ? String(play.status) : null,
    strike: Number.isFinite(Number(play.strike)) ? Number(play.strike) : null,
    live_pnl_pct: parsePnl(play),
    entry_premium: Number.isFinite(Number(play.entry_premium))
      ? Number(play.entry_premium)
      : null,
    last_mark: Number.isFinite(Number(play.last_mark)) ? Number(play.last_mark) : null,
  };
}

export async function buildSocialContentPack(
  question: string,
  tickerFocus?: string | null,
): Promise<SocialContentPack> {
  const archetype = detectSocialArchetype(question);
  const focus = tickerFocus?.trim().toUpperCase() ?? null;

  const [boardRaw, compare, record] = await Promise.all([
    zeroDtePlaysForLargo().catch(() => null),
    helixThermalCompareForLargo("SPX").catch(() => null),
    zerodteRecordForLargo(7).catch(() => null),
  ]);

  const plays = ((boardRaw as { plays?: Record<string, unknown>[] } | null)?.plays ?? []).map(
    mapPlay,
  );

  let scoped = plays;
  if (focus) {
    scoped = plays.filter((p) => p.ticker === focus);
    if (!scoped.length) scoped = plays;
  }

  const withPnl = scoped.filter((p) => p.live_pnl_pct != null);
  const winners = [...withPnl]
    .filter((p) => (p.live_pnl_pct ?? 0) > 0)
    .sort((a, b) => (b.live_pnl_pct ?? 0) - (a.live_pnl_pct ?? 0))
    .slice(0, 5);
  const losers = [...withPnl]
    .filter((p) => (p.live_pnl_pct ?? 0) < 0)
    .sort((a, b) => (a.live_pnl_pct ?? 0) - (b.live_pnl_pct ?? 0))
    .slice(0, 3);

  const openCount = scoped.filter((p) => !/closed|graded|stopped/i.test(p.status ?? "")).length;
  const closedToday = scoped.filter((p) => /closed|graded|stopped/i.test(p.status ?? "")).length;

  const record7d =
    record && (record as { available?: boolean }).available !== false
      ? {
          wins: Number((record as { wins?: number }).wins ?? 0),
          losses: Number((record as { losses?: number }).losses ?? 0),
          win_rate_pct: Number.isFinite(Number((record as { win_rate_pct?: number }).win_rate_pct))
            ? Number((record as { win_rate_pct?: number }).win_rate_pct)
            : null,
          sample_size:
            Number((record as { wins?: number }).wins ?? 0) +
            Number((record as { losses?: number }).losses ?? 0),
        }
      : null;

  const spx = compare
    ? {
        spot: compare.thermal.spot ?? null,
        flip: compare.thermal.flip ?? null,
        gamma_regime: compare.thermal.gamma_regime ?? null,
        helix_bias: compare.helix.bias,
        thermal_bias: compare.thermal.bias,
        conflict: compare.conflict,
      }
    : null;

  const board = {
    open_count: openCount,
    closed_today: closedToday,
    best_winner_pct: winners[0]?.live_pnl_pct ?? null,
    worst_loser_pct: losers[0]?.live_pnl_pct ?? null,
  };

  const post_angles = buildPostAngles(archetype, { winners, board, spx, record_7d: record7d });

  return roundFloats({
    available: plays.length > 0 || spx != null || record7d != null,
    archetype,
    as_of: new Date().toISOString(),
    ticker_focus: focus,
    winners,
    losers,
    board,
    spx,
    record_7d: record7d,
    post_angles,
  });
}
