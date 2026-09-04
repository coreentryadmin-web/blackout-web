/**
 * Vector ↔ 0DTE cross-link — best Vector pick pulse per ticker+direction for today's session.
 * Read-only; never gates commits. Surfaces "Vector is tracking this name" on the 0DTE deck.
 */
import "server-only";

import { fetchVectorPickLeaderRows } from "@/lib/vector/vector-pick-leaders-db";
import {
  rowToVectorPulse,
  shouldReplaceVectorPulse,
  type ZeroDteVectorPulse,
  type ZeroDteVectorPulseByTicker,
} from "./vector-crosslink-core";

export type { ZeroDteVectorPulse, ZeroDteVectorPulseByTicker } from "./vector-crosslink-core";
export { vectorPulseForDirection } from "./vector-crosslink-core";

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
    const pulse = rowToVectorPulse(row);
    if (!pulse?.direction) continue;
    const bucket = out[tk] ?? {};
    const dir = pulse.direction;
    if (shouldReplaceVectorPulse(bucket[dir], pulse)) {
      bucket[dir] = pulse;
      out[tk] = bucket;
    }
  }
  return out;
}
