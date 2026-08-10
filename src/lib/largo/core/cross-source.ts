/**
 * CROSS-SOURCE CONFLICT DETECTION — do two tools reporting the same quantity agree?
 *
 * This is the "conflict detection" capability from the universal-intelligence brief. Until now the
 * primitives existed (`reconcile`, `agreementOf` in core/calc.ts) with NO callers, which is a
 * different thing from having the capability: nothing was actually comparing sources.
 *
 * WHAT IT CATCHES. A turn calls get_quote, get_spx_structure and get_positioning; all three carry
 * a spot for the same instrument; two say 7757.64 and one says 7712.10 because it is serving a
 * cached snapshot. Largo picks whichever it read last and states it with a provenance stamp. The
 * number is real, traceable and grounded — and it disagrees with another number in the same turn.
 * Nothing looked.
 *
 * That is worse than a stale number alone, because the answer's own evidence contains the
 * contradiction and presents both with equal confidence. A member reading "spot 7757" in the
 * verdict and "7712" in a fact has no way to know which the analysis was built on.
 *
 * DELIBERATELY NARROW, for the same reason the self-contradiction check is. It compares only
 * NAMED PRICE-LIKE FIELDS keyed to the same instrument. It does not attempt general cross-tool
 * semantic comparison, which would need to know that "gamma flip" from one tool and "flip level"
 * from another are the same quantity — a mapping that would rot silently and produce noise. Prices
 * are the case that matters most (every level, every P&L and every wall distance is computed off
 * spot) and the one that is decidable.
 *
 * TOLERANCE. Sources are sampled at different instants, so exact equality is the wrong test. The
 * default 0.5% is wide enough to absorb normal intra-turn drift on a liquid instrument and tight
 * enough to catch a stale cache, which is typically wrong by whole percent.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

import { reconcile } from "./calc";
import { canonicalTicker } from "./entities";

/** Field names that carry a spot/underlying price. Matched exactly — a substring rule would pull
 *  in `strike_price`, `entry_premium` and every other unrelated number. */
const PRICE_FIELDS = new Set(["spot", "spot_price", "underlying_price", "last", "last_price", "price"]);

/** Fields naming the instrument a nearby price belongs to. */
const TICKER_FIELDS = new Set(["ticker", "symbol", "underlying"]);

export type SourceReading = { source: string; ticker: string; field: string; value: number };

export type SourceConflict = {
  ticker: string;
  spreadPct: number;
  min: number;
  max: number;
  readings: SourceReading[];
};

/**
 * Walk tool results and collect every price-like reading with the instrument it belongs to.
 *
 * A reading counts only when the ticker and the price sit in the SAME object. Inheriting a ticker
 * from an ancestor would attach an unrelated nested price — a contract's strike, a peer's quote —
 * to the wrong instrument and manufacture a conflict that does not exist. Missing a real conflict
 * is recoverable; inventing one trains people to ignore the warning.
 */
export function collectReadings(results: readonly unknown[]): SourceReading[] {
  const out: SourceReading[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown, source: string, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 6) return;
    if (seen.has(node)) return; // cycles
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node.slice(0, 40)) walk(item, source, depth + 1);
      return;
    }

    const obj = node as Record<string, unknown>;
    let ticker: string | null = null;
    for (const key of Object.keys(obj)) {
      if (TICKER_FIELDS.has(key) && typeof obj[key] === "string") {
        ticker = canonicalTicker(obj[key] as string)?.key ?? null;
        if (ticker) break;
      }
    }
    if (ticker) {
      for (const key of Object.keys(obj)) {
        if (!PRICE_FIELDS.has(key)) continue;
        const v = obj[key];
        if (typeof v === "number" && Number.isFinite(v) && v > 0) {
          out.push({ source, ticker, field: key, value: v });
        }
      }
    }
    for (const key of Object.keys(obj)) walk(obj[key], source, depth + 1);
  };

  results.forEach((r, i) => walk(r, `result[${i}]`, 0));
  return out;
}

/**
 * Instruments whose price two or more sources disagree about.
 *
 * Uses `reconcile` from the calculation engine rather than comparing inline, so the zero-base guard
 * and the "fewer than two readings is not a disagreement" rule are the same ones every other
 * calculation obeys.
 */
export function findSourceConflicts(
  results: readonly unknown[],
  tolerancePct = 0.5
): SourceConflict[] {
  const byTicker = new Map<string, SourceReading[]>();
  for (const r of collectReadings(results)) {
    const arr = byTicker.get(r.ticker);
    if (arr) arr.push(r);
    else byTicker.set(r.ticker, [r]);
  }

  const conflicts: SourceConflict[] = [];
  for (const [ticker, readings] of byTicker) {
    if (readings.length < 2) continue;
    const check = reconcile(
      readings.map((r) => ({ source: r.source, value: r.value })),
      tolerancePct
    );
    if (check.ok || check.spreadPct == null || check.min == null || check.max == null) continue;
    conflicts.push({
      ticker,
      spreadPct: check.spreadPct,
      min: check.min,
      max: check.max,
      readings,
    });
  }
  // Worst first — if several instruments disagree, the widest spread is the one to look at.
  conflicts.sort((a, b) => b.spreadPct - a.spreadPct);
  return conflicts.slice(0, 2);
}

/**
 * Append the disagreement.
 *
 * States the range rather than picking a winner. This layer has no basis for deciding which source
 * is right — that depends on which is freshest, and freshness is exactly what is in doubt when two
 * sources disagree. Naming a winner here would be the averaging mistake `agreementOf` exists to
 * refuse, in a different costume.
 */
export function applyConflictCaveat(text: string, conflicts: readonly SourceConflict[]): string {
  if (conflicts.length === 0) return text;
  const c = conflicts[0]!;
  return (
    `${text}\n\n> **Sources disagree on ${c.ticker}.** This turn read prices ranging ` +
    `${c.min} to ${c.max} (${c.spreadPct.toFixed(2)}% apart) across ${c.readings.length} sources — ` +
    `one of them is likely serving a stale snapshot. Treat any level or P&L computed off ${c.ticker} ` +
    `spot as approximate until they reconcile.`
  );
}
