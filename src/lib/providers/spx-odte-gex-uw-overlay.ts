import type { GexHeatmap } from "@/lib/providers/polygon-options-gex";
import { resolveOdteExpiry } from "@/lib/correctness/gex-odte-scope";
import { wallsFromStrikeTotals, cumulativeGammaFlip } from "@/lib/providers/gex-cross-validation-core";
import { todayEtYmd } from "@/lib/providers/spx-session";
import {
  getSpxOdteScopedUwLadderMap,
  resetSpxOdteScopedUwLadderCacheForTests,
} from "@/lib/providers/spx-odte-uw-ladder";

/** Re-export for tests that reset overlay + scoped ladder caches together. */
export { resetSpxOdteScopedUwLadderCacheForTests as resetSpxOdteUwLadderCacheForTests };

/** Re-sum near-term strike_totals after a 0DTE column overlay. */
export function recomputeNearTermGexStrikeTotals(hm: GexHeatmap): void {
  const near = new Set(hm.near_term_expiries?.length ? hm.near_term_expiries : hm.expiries.slice(0, 8));
  const totals: Record<string, number> = {};
  let total = 0;
  for (const [strike, byExp] of Object.entries(hm.gex.cells)) {
    let sum = 0;
    for (const [exp, val] of Object.entries(byExp ?? {})) {
      if (near.has(exp) && typeof val === "number" && Number.isFinite(val)) sum += val;
    }
    if (sum !== 0) {
      totals[strike] = sum;
      total += sum;
    }
  }
  hm.gex.strike_totals = totals;
  hm.gex.total = total;

  const { callWall, putWall } = wallsFromStrikeTotals(totals);
  hm.gex.call_wall = callWall;
  hm.gex.put_wall = putWall;
  hm.gex.flip = cumulativeGammaFlip(totals, hm.spot);
}

/**
 * SPX 0DTE column: replace Polygon-derived cells with UW dealer gamma ladder rows.
 * Pure — caller supplies the UW 0DTE per-strike ladder (WS or REST).
 */
export function applySpxOdteGexUwOverlayWithLadder(
  hm: GexHeatmap,
  ladder: ReadonlyMap<number, number>,
  today = todayEtYmd()
): GexHeatmap {
  if (hm.underlying !== "SPX" || !(hm.spot > 0) || hm.strikes.length === 0) return hm;
  if (!hm.expiries.includes(today) || ladder.size === 0) return hm;

  const cells: Record<string, Record<string, number>> = {};
  for (const [sk, byExp] of Object.entries(hm.gex.cells)) {
    const row = { ...byExp };
    delete row[today];
    if (Object.keys(row).length > 0) cells[sk] = row;
  }

  const strikeSet = new Set<number>();
  for (const s of hm.strikes) {
    if (cells[String(s)]) strikeSet.add(s);
  }

  for (const [strike, net] of ladder) {
    const sk = String(strike);
    const row = { ...(cells[sk] ?? {}) };
    row[today] = net;
    cells[sk] = row;
    strikeSet.add(strike);
  }

  const out: GexHeatmap = {
    ...hm,
    strikes: Array.from(strikeSet).sort((a, b) => b - a),
    gex: { ...hm.gex, cells },
  };
  recomputeNearTermGexStrikeTotals(out);
  return out;
}

/**
 * SPX 0DTE column: replace Polygon-derived cells with UW dealer gamma (WS-first, REST 0DTE).
 * Polygon chain GEX and UW spot-exposures can disagree on the King strike by >1.5% of spot during
 * RTH — the data-correctness oracle uses the same 0DTE-scoped ladder, so members must see the same King.
 */
export async function applySpxOdteGexUwOverlay(hm: GexHeatmap): Promise<GexHeatmap> {
  if (hm.underlying !== "SPX" || !(hm.spot > 0) || hm.strikes.length === 0) return hm;

  const today = todayEtYmd();
  const expiry = resolveOdteExpiry(hm.expiries ?? [], today);
  if (!expiry || !hm.expiries.includes(expiry)) return hm;

  const ladder = await getSpxOdteScopedUwLadderMap(expiry);
  if (!ladder || ladder.size === 0) return hm;

  return applySpxOdteGexUwOverlayWithLadder(hm, ladder, expiry);
}
