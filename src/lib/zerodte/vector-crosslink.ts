/**
 * Vector ↔ 0DTE cross-link — best Vector pick pulse per ticker for today's session.
 * Read-only; never gates commits. Surfaces "Vector is tracking this name" on the 0DTE deck.
 */
import "server-only";

import { fetchVectorPickLeaderRows } from "@/lib/vector/vector-pick-leaders-db";
import {
  isVectorPickRunner,
  isVectorPickWinner,
} from "@/lib/vector/vector-pick-sweep-core";

function sideToDirection(side: string | null | undefined): "long" | "short" | null {
  const s = (side ?? "").toLowerCase();
  if (s === "call") return "long";
  if (s === "put") return "short";
  return null;
}

export type ZeroDteVectorPulse = {
  /** Best live premium % from entry across this ticker's leaders today. */
  premium_pct: number | null;
  peak_premium_pct: number | null;
  action_status: string | null;
  /** Tagged +50% live or peak — Vector winner floor. */
  is_winner: boolean;
  /** +15%…+49% building band. */
  is_runner: boolean;
  /** Best leader contract side (call/put). */
  side: "call" | "put" | null;
  /** Desk direction implied by side. */
  direction: "long" | "short" | null;
  strike: number | null;
  occ: string | null;
  rank: number | null;
  role: string | null;
};

function bestPct(a: number | null, b: number | null): number | null {
  const vals = [a, b].filter((n): n is number => n != null && Number.isFinite(n));
  if (vals.length === 0) return null;
  return Math.max(...vals);
}

/** Map tickers → their strongest Vector leader pulse for the session (subset of board tickers). */
export async function fetchZeroDteVectorPulseByTicker(
  sessionDate: string,
  tickers: string[]
): Promise<Record<string, ZeroDteVectorPulse>> {
  const want = new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean));
  if (want.size === 0 || !sessionDate) return {};

  const rows = await fetchVectorPickLeaderRows({ sessionDate, limit: 400 }).catch(() => []);
  const out: Record<string, ZeroDteVectorPulse> = {};

  for (const row of rows) {
    const tk = String(row.ticker ?? "").trim().toUpperCase();
    if (!want.has(tk)) continue;
    const live = row.premium_pct_from_entry ?? null;
    const peak = row.peak_premium_pct ?? null;
    const best = bestPct(live, peak);
    const existing = out[tk];
    const existingBest = existing ? bestPct(existing.premium_pct, existing.peak_premium_pct) : null;
    if (existing && existingBest != null && best != null && best <= existingBest) continue;

    const sideRaw = String(row.side ?? "").toLowerCase();
    const side: "call" | "put" | null = sideRaw === "call" ? "call" : sideRaw === "put" ? "put" : null;
    const pulse: ZeroDteVectorPulse = {
      premium_pct: live,
      peak_premium_pct: peak,
      action_status: row.action_status ?? null,
      is_winner: isVectorPickWinner({
        premium_pct_from_entry: live,
        peak_premium_pct: peak,
        action_status: row.action_status ?? "",
      }),
      is_runner: isVectorPickRunner({
        premium_pct_from_entry: live,
        peak_premium_pct: peak,
        action_status: row.action_status ?? "",
      }),
      side,
      direction: sideToDirection(side),
      strike: typeof row.strike === "number" && Number.isFinite(row.strike) ? row.strike : null,
      occ: typeof row.occ === "string" && row.occ.trim() ? row.occ.trim() : null,
      rank: typeof row.rank === "number" && Number.isFinite(row.rank) ? row.rank : null,
      role: row.role ?? null,
    };
    out[tk] = pulse;
  }
  return out;
}
