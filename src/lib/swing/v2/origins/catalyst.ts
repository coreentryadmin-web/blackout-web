/**
 * CATALYST origin screen (Swing Engine V2 P2) — earnings drift + event impulse.
 *
 * Tier-0 admits tickers with an actionable event inside the 4–15 DTE swing window:
 * upcoming prints (pre-earnings momentum) or recent prints (post-earnings drift).
 * PURE scoring — IO lives in catalyst-screen.ts via Meridian/Benzinga bundle.
 */

import type { BenzingaStructuredEarnings } from "@/lib/providers/polygon";
import { POST_EARNINGS_DRIFT_WINDOW_DAYS } from "../../swing-catalyst";

/** Max calendar days ahead for an upcoming print to seed a swing catalyst thesis. */
export const SWING_CATALYST_EARNINGS_AHEAD_DAYS = 15;

export type CatalystOriginKind = "PRE_EARNINGS" | "POST_EARNINGS_DRIFT";

export interface CatalystOriginCandidate {
  ticker: string;
  kind: CatalystOriginKind;
  eventDate: string;
  daysToEvent: number;
  importance: number | null;
  score: number;
  reason: string;
}

function daysBetweenYmd(fromYmd: string, toYmd: string): number | null {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function surprisePct(row: BenzingaStructuredEarnings): number | null {
  if (row.eps_surprise_pct != null && Number.isFinite(row.eps_surprise_pct)) {
    const n = Number(row.eps_surprise_pct);
    return Math.abs(n) <= 1.5 ? n * 100 : n;
  }
  if (
    row.estimated_eps != null &&
    row.actual_eps != null &&
    row.estimated_eps !== 0 &&
    Number.isFinite(row.estimated_eps) &&
    Number.isFinite(row.actual_eps)
  ) {
    return ((row.actual_eps - row.estimated_eps) / Math.abs(row.estimated_eps)) * 100;
  }
  return null;
}

/** Pure: score one Benzinga earnings row for Tier-0 CATALYST admission. */
export function scoreCatalystEarningsRowForSwing(
  row: BenzingaStructuredEarnings,
  todayYmd: string,
): CatalystOriginCandidate | null {
  const ticker = String(row.ticker ?? "").trim().toUpperCase();
  const date = String(row.date ?? "").slice(0, 10);
  if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const delta = daysBetweenYmd(todayYmd, date);
  if (delta == null) return null;

  const importance = row.importance != null && Number.isFinite(row.importance) ? row.importance : null;
  const printed = row.actual_eps != null || row.actual_revenue != null;

  // Upcoming print inside swing hold window.
  if (delta >= 0 && delta <= SWING_CATALYST_EARNINGS_AHEAD_DAYS) {
    // Beyond a week, require at least medium importance so the screen isn't all small caps.
    if (delta > 7 && (importance == null || importance < 2)) return null;
    let score = 58;
    if (importance != null && importance >= 4) score += 18;
    else if (importance != null && importance >= 2) score += 10;
    if (delta <= 3) score += 12;
    else if (delta <= 7) score += 6;
    if (row.date_status === "confirmed") score += 5;
    return {
      ticker,
      kind: "PRE_EARNINGS",
      eventDate: date,
      daysToEvent: delta,
      importance,
      score: Math.min(100, score),
      reason: `earnings in ${delta}d${importance != null ? ` (importance ${importance})` : ""}`,
    };
  }

  // Recent print — post-earnings drift window.
  if (delta < 0 && -delta <= POST_EARNINGS_DRIFT_WINDOW_DAYS && printed) {
    const daysAgo = -delta;
    const surprise = surprisePct(row);
    let score = 55;
    if (surprise != null && Math.abs(surprise) >= 5) score += 15;
    if (daysAgo <= 5) score += 10;
    else if (daysAgo <= 10) score += 5;
    return {
      ticker,
      kind: "POST_EARNINGS_DRIFT",
      eventDate: date,
      daysToEvent: -daysAgo,
      importance,
      score: Math.min(100, score),
      reason: `post-earnings ${daysAgo}d ago${surprise != null ? ` (${surprise > 0 ? "+" : ""}${surprise.toFixed(1)}% EPS)` : ""}`,
    };
  }

  return null;
}

/** Batch screen earnings rows — dedupes by ticker, keeps highest score. */
export function screenCatalystFromEarningsRows(
  rows: readonly BenzingaStructuredEarnings[],
  todayYmd: string,
): CatalystOriginCandidate[] {
  const best = new Map<string, CatalystOriginCandidate>();
  for (const row of rows) {
    const hit = scoreCatalystEarningsRowForSwing(row, todayYmd);
    if (!hit) continue;
    const prev = best.get(hit.ticker);
    if (!prev || hit.score > prev.score) best.set(hit.ticker, hit);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}
