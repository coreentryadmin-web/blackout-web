import type { GexHeatmap } from "@/lib/providers/polygon-options-gex";
import { resolveOdteExpiry } from "@/lib/correctness/gex-odte-scope";
import { wallsFromStrikeTotals, cumulativeGammaFlip, buildGexRegime } from "@/lib/providers/gex-cross-validation-core";
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
  const flip = cumulativeGammaFlip(totals, hm.spot);
  hm.gex.flip = flip;

  // REBUILD THE REGIME FROM THE NEW FLIP — it used to be left behind here.
  //
  // Everything above is re-derived after the UW 0DTE ladder replaces today's column, but
  // `hm.gex.regime` was not. `GexRegime.flip` is documented as "mirrors gex.flip", and on SPX it
  // stopped doing so the moment this overlay ran: the served payload carried a flip from the
  // overlaid book beside a regime — its own `flip`, its `posture`, and its `read` sentence — still
  // describing the pre-overlay one.
  //
  // Measured on prod 2026-08-20:
  //     gex.flip ........ 7893.38
  //     regime.flip ..... 7887.16   (6.22 pts stale)
  //     regime.read ..... "... below the gamma flip (7,887.15) -> short gamma ..."
  // The delta held across four samples 20s apart AND through a forced rebuild (`?force=1`, 9.5s),
  // which is what ruled out caching: this overlay re-runs per request and re-created the skew every
  // time. Largo, handed both numbers under one name, reported both — "Gamma flip 7891.94 (7886.81
  // on Thermal matrix)" — which reads to a member as the product contradicting itself.
  //
  // The 6 points are the visible symptom; `posture` is the real exposure. It is
  // `spot >= flip ? long : short`, and long vs short gamma inverts the whole interpretation
  // (dampened/mean-reverting vs amplified/trending). With spot ~180 pts below both flips the answer
  // was "short" either way, which is precisely why this survived unnoticed — the failure only bites
  // when spot sits BETWEEN the two.
  hm.gex.regime = buildGexRegime({ spot: hm.spot, flip, callWall, putWall });
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
