import type { GexHeatmap, SpxOdteOverlayState } from "@/lib/providers/polygon-options-gex";
import { resolveOdteExpiry } from "@/lib/correctness/gex-odte-scope";
import { wallsFromStrikeTotals, cumulativeGammaFlipDetail, buildGexRegime, wallsByHorizon } from "@/lib/providers/gex-cross-validation-core";
import { todayEtYmd } from "@/lib/providers/spx-session";
import {
  getSpxOdteScopedUwLadderMap,
  resetSpxOdteScopedUwLadderCacheForTests,
} from "@/lib/providers/spx-odte-uw-ladder";

/** Re-export for tests that reset overlay + scoped ladder caches together. */
export { resetSpxOdteScopedUwLadderCacheForTests as resetSpxOdteUwLadderCacheForTests };

/** Re-sum near-term strike_totals after a 0DTE column overlay. */
export function recomputeNearTermGexStrikeTotals(hm: GexHeatmap, today = todayEtYmd()): void {
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

  // Side-constrained: `hm.spot` is the same spot the rest of this recompute uses, so a wall that
  // lands on the wrong side of it was never a level a member could act on.
  const { callWall, putWall } = wallsFromStrikeTotals(totals, hm.spot);
  hm.gex.call_wall = callWall;
  hm.gex.put_wall = putWall;
  // DETAIL, not just the value: the overlay replaces today's 0DTE column, so it must recompute
  // WHY the flip is null alongside the flip itself. Carrying the value while inheriting the
  // pre-overlay reason is the same class of staleness this function was fixed for once already.
  const flipDetail = cumulativeGammaFlipDetail(totals, hm.spot);
  const flip = flipDetail.flip;
  hm.gex.flip_reason = flipDetail.reason;
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
  hm.gex.regime = buildGexRegime({ spot: hm.spot, flip, callWall, putWall, flipReason: flipDetail.reason });

  // AND THE HORIZONS, for the same reason and with sharper stakes.
  //
  // This overlay REPLACES today's 0DTE column with the UW dealer-gamma ladder, so the "0DTE" bucket
  // is the one bucket it definitionally invalidates. Until now that was harmless only because
  // `walls_by_horizon` was never populated on a fresh build at all (it was set solely by
  // prunePastExpiriesFromHeatmap, which no-ops on a fresh matrix). Populating it upstream would
  // have made this function carry a PRE-overlay 0DTE wall beside a POST-overlay flip and regime —
  // the third instance of exactly the staleness this function has already been fixed for twice
  // (first `regime`, then `flip_reason`). Recomputing it here means the two cannot separate.
  //
  // Same input as the fresh build: the post-overlay cells, the ET session, and this heatmap's own
  // spot, so every bucket is side-constrained against the price the rest of the payload describes.
  hm.gex.walls_by_horizon = wallsByHorizon(hm.gex.cells, today, hm.spot);
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
  // Pass the PINNED `today` through: this function already takes an explicit session date so a
  // test (and the 0DTE scope above) can pin it, and the recompute derives DTE buckets from it.
  // Letting it default to the wall clock here would let the overlay and its own horizons disagree
  // about which session they describe.
  recomputeNearTermGexStrikeTotals(out, today);
  return out;
}

/**
 * SPX 0DTE column: replace Polygon-derived cells with UW dealer gamma (WS-first, REST 0DTE).
 * Polygon chain GEX and UW spot-exposures can disagree on the King strike by >1.5% of spot during
 * RTH — the data-correctness oracle uses the same 0DTE-scoped ladder, so members must see the same King.
 */
export async function applySpxOdteGexUwOverlay(hm: GexHeatmap): Promise<GexHeatmap> {
  /**
   * STAMP WHETHER THE OVERLAY RAN — every exit, including the silent ones.
   *
   * When the UW ladder is missing this function returns the UN-OVERLAID matrix, and the payload
   * looked identical to an overlaid one: same shape, same `live` tag, no marker. So the endpoint
   * served TWO DIFFERENT BOOKS interchangeably and nothing downstream could tell which it had.
   *
   * MEASURED ON PROD 2026-08-20 during RTH, 12 samples ~2s apart: 8 distinct payload signatures,
   * including two consecutive reads at an IDENTICAL spot (7694.11) returning 216 strikes / -17.21B
   * and 185 strikes / -13.70B. Walls swung call 7750<->7900 and put 7400->7690->7600->7500 on a
   * 0.12% spot move. A member asking twice inside a minute got three different wall pairs, each
   * tagged "live".
   *
   * Two controls point the same way. SPY — which has no overlay — held 268-270 strikes across the
   * whole session. And post-close, when this function no-ops because today's expiry has dropped out
   * of `hm.expiries`, SPX itself was rock stable: 184 strikes and an identical range across 6
   * samples. Both are consistent with the overlay, not with chain pagination (the page guard is
   * 200, floored at 40) which was the earlier and wrong hypothesis.
   *
   * This change is OBSERVABILITY ONLY — no served number moves. It exists because the correlation
   * above is inferred from shape, and a `applied: false` flag turns confirming it into reading one
   * field instead of re-deriving it from strike counts. The same lesson as the audit-session bug
   * fixed earlier today: a path that cannot report its own failure costs far more than the failure.
   */
  const mark = (applied: boolean, reason: SpxOdteOverlayState["reason"]): GexHeatmap => {
    hm.gex.odte_overlay = { applied, reason };
    return hm;
  };

  if (hm.underlying !== "SPX" || !(hm.spot > 0) || hm.strikes.length === 0) return mark(false, "not_applicable");

  const today = todayEtYmd();
  const expiry = resolveOdteExpiry(hm.expiries ?? [], today);
  // Not a fault: outside RTH there is no 0DTE expiry left to overlay.
  if (!expiry || !hm.expiries.includes(expiry)) return mark(false, "no_odte_expiry");

  const ladder = await getSpxOdteScopedUwLadderMap(expiry);
  // THE ONE THAT MATTERS. A 0DTE expiry exists and should have been overlaid, and was not — so
  // this payload is the raw Polygon book while a neighbouring request may carry the UW-overlaid one.
  if (!ladder || ladder.size === 0) {
    console.warn(
      `[spx-odte-overlay] ladder unavailable for ${expiry} — serving UN-OVERLAID SPX matrix; walls/flip/total differ from an overlaid read`
    );
    return mark(false, "ladder_unavailable");
  }

  const out = applySpxOdteGexUwOverlayWithLadder(hm, ladder, expiry);
  out.gex.odte_overlay = { applied: true, reason: "applied" };
  return out;
}
