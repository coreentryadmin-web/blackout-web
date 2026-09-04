/**
 * Vector ↔ 0DTE cross-link — best Vector pick pulse per ticker+direction for today's session.
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

/** Per-ticker pulses keyed by desk direction — avoids picking a winning PUT when 0DTE wants LONG. */
export type ZeroDteVectorPulseByTicker = Record<
  string,
  Partial<Record<"long" | "short", ZeroDteVectorPulse>>
>;

function bestPct(a: number | null, b: number | null): number | null {
  const vals = [a, b].filter((n): n is number => n != null && Number.isFinite(n));
  if (vals.length === 0) return null;
  return Math.max(...vals);
}

function rowToPulse(row: {
  premium_pct_from_entry?: number | null;
  peak_premium_pct?: number | null;
  action_status?: string | null;
  side?: string | null;
  strike?: number | null;
  occ?: string | null;
  rank?: number | null;
  role?: string | null;
}): ZeroDteVectorPulse | null {
  const live = row.premium_pct_from_entry ?? null;
  const peak = row.peak_premium_pct ?? null;
  const sideRaw = String(row.side ?? "").toLowerCase();
  const side: "call" | "put" | null = sideRaw === "call" ? "call" : sideRaw === "put" ? "put" : null;
  const direction = sideToDirection(side);
  if (!direction) return null;
  return {
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
    direction,
    strike: typeof row.strike === "number" && Number.isFinite(row.strike) ? row.strike : null,
    occ: typeof row.occ === "string" && row.occ.trim() ? row.occ.trim() : null,
    rank: typeof row.rank === "number" && Number.isFinite(row.rank) ? row.rank : null,
    role: row.role ?? null,
  };
}

function shouldReplacePulse(
  existing: ZeroDteVectorPulse | undefined,
  candidate: ZeroDteVectorPulse
): boolean {
  if (!existing) return true;
  const existingBest = bestPct(existing.premium_pct, existing.peak_premium_pct);
  const candidateBest = bestPct(candidate.premium_pct, candidate.peak_premium_pct);
  if (existingBest == null) return true;
  if (candidateBest == null) return false;
  return candidateBest > existingBest;
}

/** Resolve direction-specific pulse; falls back to legacy flat map shape. */
export function vectorPulseForDirection(
  map: ZeroDteVectorPulseByTicker | Record<string, ZeroDteVectorPulse>,
  ticker: string,
  direction: "long" | "short"
): ZeroDteVectorPulse | null {
  const tk = ticker.trim().toUpperCase();
  const entry = map[tk];
  if (!entry) return null;
  if ("long" in entry || "short" in entry) {
    return (entry as Partial<Record<"long" | "short", ZeroDteVectorPulse>>)[direction] ?? null;
  }
  const legacy = entry as ZeroDteVectorPulse;
  if (legacy.direction && legacy.direction !== direction) return null;
  return legacy;
}

/** Map tickers → strongest Vector leader pulse per direction for the session. */
export async function fetchZeroDteVectorPulseByTicker(
  sessionDate: string,
  tickers: string[]
): Promise<ZeroDteVectorPulseByTicker> {
  const want = new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean));
  if (want.size === 0 || !sessionDate) return {};

  const rows = await fetchVectorPickLeaderRows({ sessionDate, limit: 400 }).catch(() => []);
  const out: ZeroDteVectorPulseByTicker = {};

  for (const row of rows) {
    const tk = String(row.ticker ?? "").trim().toUpperCase();
    if (!want.has(tk)) continue;
    const pulse = rowToPulse(row);
    if (!pulse?.direction) continue;
    const bucket = out[tk] ?? {};
    const dir = pulse.direction;
    if (shouldReplacePulse(bucket[dir], pulse)) {
      bucket[dir] = pulse;
      out[tk] = bucket;
    }
  }
  return out;
}
