/**
 * The UW REST fallback (`/spot-exposures/strike`) sums every expiry server-side with no
 * per-expiry field to filter on — it structurally cannot be scoped to match Polygon's
 * near-term-only walls (verified live 2026-07-01 against the real UW API: the sibling
 * `/spot-exposures/expiry-strike` endpoint DOES carry a per-row expiry, but its
 * `expirations[]` filter only honors one value even when several are passed, and
 * unfiltered it caps at 50 rows that don't reliably cover the needed strike band). When
 * the caller requires scoping, running the REST fallback anyway would compare mismatched
 * universes and produce a guaranteed false-positive divergence — worse than skipping the
 * check. See `gex-cross-validation.ts`'s module-level SCOPE doc for the full write-up.
 */
export function restFallbackAllowed(nearTermExpiries: readonly string[] | undefined): boolean {
  return !(nearTermExpiries && nearTermExpiries.length > 0);
}

/**
 * Scope a GexHeatmap-shaped object's expiries down to the near-term-only set that
 * `call_wall`/`put_wall`/`flip` are actually computed from, for passing to
 * `validateGexAgainstUW`. Prefer the authoritative `near_term_expiries` field (the
 * pre-far-merge set the engine captured before far-dated monthly/quarterly columns were
 * added — see `resolveExpiryAxis()` in polygon-options-gex.ts). `expiries.slice(0, N)`
 * LOOKS equivalent but is not: on a ticker whose real near-term (daily/weekly) expiry
 * count is below N, the post-merge sorted `expiries` array silently pads the slice with
 * far-dated columns (they sort right after the real near dates) — reintroducing the exact
 * bug class `resolveExpiryAxis()` was built to prevent for max_pain/GEX/VEX/DEX/CHARM. For
 * any non-SPX/SPY/QQQ single-name ticker (most only have weekly+monthly options, no daily
 * 0DTE), that's the common case, not an edge case. Falls back to the slice only for legacy
 * cached heatmaps predating the `near_term_expiries` field.
 */
export function resolveNearTermExpiriesForCrossValidation(
  hm: { near_term_expiries?: string[]; expiries?: string[] } | null | undefined,
  legacySliceCount = 8
): string[] | undefined {
  if (hm?.near_term_expiries?.length) return hm.near_term_expiries;
  return hm?.expiries?.slice(0, legacySliceCount);
}

/** Largest-positive (call) and largest-negative (put) wall strikes from per-strike totals. */
export function wallsFromStrikeTotals(strikeTotals: Record<string, number>): {
  callWall: number | null;
  putWall: number | null;
} {
  let callWall: number | null = null;
  let putWall: number | null = null;
  let maxPos = 0;
  let maxNeg = 0;
  for (const [s, gRaw] of Object.entries(strikeTotals)) {
    const strike = Number(s);
    const g = Number(gRaw);
    if (!Number.isFinite(strike) || !Number.isFinite(g)) continue;
    if (g > maxPos) {
      maxPos = g;
      callWall = strike;
    }
    if (g < maxNeg) {
      maxNeg = g;
      putWall = strike;
    }
  }
  return { callWall, putWall };
}

/** Argmax |net| strike — the GEX King node. */
export function kingFromStrikeTotals(strikeTotals: Record<string, number>): number | null {
  let king: number | null = null;
  let maxAbs = -1;
  for (const [s, gRaw] of Object.entries(strikeTotals)) {
    const strike = Number(s);
    const g = Number(gRaw);
    if (!Number.isFinite(strike) || !Number.isFinite(g)) continue;
    if (Math.abs(g) > maxAbs) {
      maxAbs = Math.abs(g);
      king = strike;
    }
  }
  return king;
}

/**
 * Zero-crossing level: the strike (linear-interpolated to value=0) where a per-strike net Greek
 * total changes sign — in EITHER direction — choosing the crossing NEAREST spot. Falls back to
 * cumulative-sum crossing for unusual profiles with no clean per-strike sign flip.
 *
 * GENERIC by design: this is reused for the VEX flip and the DEX / CHARM zero-levels
 * (polygon-options-gex.ts), where a per-strike sign crossing in either direction is exactly the
 * right "where does this Greek profile flip sign across strikes" definition. Do NOT retarget it to
 * the cumulative gamma-flip definition — the GEX gamma flip has its own `cumulativeGammaFlip`
 * (below), which is the SpotGamma aggregate-zero-gamma boundary. See docs/audit/FINDINGS.md.
 */
export function zeroGammaFlip(strikeTotals: Record<string, number>, spot = 0): number | null {
  const rows = Object.entries(strikeTotals)
    .map(([s, g]) => ({ strike: Number(s), gamma: g }))
    .filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.gamma))
    .sort((a, b) => a.strike - b.strike);
  if (rows.length < 2) return null;

  const crossings: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]!;
    const b = rows[i]!;
    if ((a.gamma < 0 && b.gamma > 0) || (a.gamma > 0 && b.gamma < 0)) {
      const frac = (0 - a.gamma) / (b.gamma - a.gamma);
      crossings.push(Number((a.strike + (b.strike - a.strike) * frac).toFixed(2)));
    }
  }
  if (crossings.length) {
    return spot > 0
      ? crossings.reduce((best, c) => (Math.abs(c - spot) < Math.abs(best - spot) ? c : best))
      : crossings[crossings.length - 1];
  }

  // Fallback: cumulative-sum crossing for profiles with no clean per-strike sign flip.
  const cum: number[] = [];
  let running = 0;
  for (const r of rows) {
    running += r.gamma;
    cum.push(running);
  }
  for (let i = 1; i < cum.length; i++) {
    const prevCum = cum[i - 1]!;
    const nextCum = cum[i]!;
    if (prevCum !== 0 && nextCum !== 0 && Math.sign(nextCum) !== Math.sign(prevCum)) {
      const span = rows[i]!.strike - rows[i - 1]!.strike;
      const frac = prevCum / (prevCum - nextCum);
      return Number((rows[i - 1]!.strike + span * frac).toFixed(2));
    }
  }
  return null;
}

/**
 * Gamma flip (SpotGamma-standard): the price where CUMULATIVE dealer gamma, summed low→high strike,
 * crosses from net-short (≤0) to net-long (>0) — the aggregate zero-gamma regime boundary. This is
 * the SAME definition the reconstruct rail (`gammaFlipFromLadder`) and the SPX desk
 * (`computeGammaFlip`) use, so every GEX surface now reports one flip. Collects every
 * net-short→net-long crossing and returns the one NEAREST spot, rejecting any crossing beyond
 * ±FLIP_MAX_DIST_PCT of spot as a thin-far-strike artifact of the banded chain snapshot.
 *
 * Returns null (never a fabricated level) when cumulative gamma never turns positive — dealers are
 * net-short at EVERY strike, so there is no long-gamma region and hence no honest flip. This
 * replaces the old per-strike `zeroGammaFlip` for the GAMMA flip specifically: on a
 * net-short-everywhere book the per-strike crossing could interpolate a spurious level below spot
 * and INVERT the `spot >= flip ? "long" : "short"` regime posture. VEX/DEX/CHARM zero-levels keep
 * using the per-strike `zeroGammaFlip` — only the gamma flip is cumulative. See docs/audit/FINDINGS.md.
 */
export function cumulativeGammaFlip(strikeTotals: Record<string, number>, spot = 0): number | null {
  return cumulativeGammaFlipDetail(strikeTotals, spot).flip;
}

/**
 * WHY a gamma flip is null. The bare `number | null` return above collapses THREE materially
 * different states into one value, and every downstream consumer (`gammaRegime`, the Vector
 * regime paint, the SPX desk) maps all three to the same `"unknown"` — so an operator seeing a
 * blank flip cannot tell an honest structural fact from a data outage:
 *
 *  - `net_short_everywhere` — cumulative gamma never turns positive. Dealers are net-short at
 *    EVERY strike, so there IS no long-gamma region and no flip exists. This is a real, tradeable
 *    read (unstable/accelerating regime), not missing data. Observed live on IWM 2026-08-17
 *    (spot 304.03, 115 strikes, zero crossings) while SPX/SPY/QQQ/NVDA/TSLA all resolved.
 *  - `crossings_far_from_spot` — crossings exist but all lie beyond ±12% of spot, i.e. thin
 *    far-strike artifacts of a banded chain snapshot. Suspicious data, not a regime read.
 *  - `insufficient_strikes` — fewer than 2 usable strikes. A pure data outage.
 *
 * `nearestCrossing` is retained even when rejected so the far-crossing case can be inspected
 * without a re-run: the whole reason this distinction had to be caught live is that the null
 * carried no evidence about which branch produced it.
 */
export type GammaFlipReason =
  | "resolved"
  | "insufficient_strikes"
  | "net_short_everywhere"
  | "crossings_far_from_spot";

export type GammaFlipDetail = {
  flip: number | null;
  reason: GammaFlipReason;
  /** Count of net-short→net-long cumulative crossings found, before the plausibility filter. */
  crossings: number;
  /** Crossing nearest spot, INCLUDING ones rejected as implausible. Null when none exist. */
  nearestCrossing: number | null;
};

const FLIP_MAX_DIST_PCT = 0.12;

/**
 * How close a plausible crossing must be to the PREVIOUS reported flip to be treated as the same
 * level. 0.4% of spot — wide enough to absorb a strike-grid step and a snapshot's worth of
 * cumulative-gamma noise, far narrower than the ~10% relocations the nearest-spot rule produced.
 */
const FLIP_HYSTERESIS_PCT = 0.004;

/** `cumulativeGammaFlip` with the null cause attached — see GammaFlipReason. */
export function cumulativeGammaFlipDetail(
  strikeTotals: Record<string, number>,
  spot = 0,
  opts?: {
    /**
     * The flip this ticker reported on the previous snapshot, when the caller has it. Supplying it
     * enables hysteresis: a plausible crossing within FLIP_HYSTERESIS_PCT of the incumbent wins, so
     * a level cannot be relocated by noise between two adjacent scans.
     */
    previousFlip?: number | null;
  }
): GammaFlipDetail {
  const rows = Object.entries(strikeTotals)
    .map(([s, g]) => ({ strike: Number(s), gamma: g }))
    .filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.gamma))
    .sort((a, b) => a.strike - b.strike);
  if (rows.length < 2) {
    return { flip: null, reason: "insufficient_strikes", crossings: 0, nearestCrossing: null };
  }

  const crossings: number[] = [];
  let cum = 0;
  let prevStrike = rows[0]!.strike;
  let prevCum = 0;
  for (const r of rows) {
    cum += r.gamma;
    if (prevCum <= 0 && cum > 0) {
      // In this branch cum > 0 >= prevCum, so cum - prevCum is always > 0 (no divide-by-zero).
      const frac = -prevCum / (cum - prevCum);
      crossings.push(Number((prevStrike + frac * (r.strike - prevStrike)).toFixed(2)));
    }
    prevStrike = r.strike;
    prevCum = cum;
  }
  if (crossings.length === 0) {
    return { flip: null, reason: "net_short_everywhere", crossings: 0, nearestCrossing: null };
  }

  const nearest =
    spot > 0
      ? crossings.reduce((best, c) => (Math.abs(c - spot) < Math.abs(best - spot) ? c : best))
      : crossings[crossings.length - 1]!;

  if (!(spot > 0)) {
    return {
      flip: crossings[crossings.length - 1]!,
      reason: "resolved",
      crossings: crossings.length,
      nearestCrossing: nearest,
    };
  }

  const plausible = crossings.filter((c) => Math.abs(c - spot) <= spot * FLIP_MAX_DIST_PCT);
  if (plausible.length === 0) {
    return {
      flip: null,
      reason: "crossings_far_from_spot",
      crossings: crossings.length,
      nearestCrossing: nearest,
    };
  }
  // SELECTION: the LOWEST plausible crossing, not the one nearest spot.
  //
  // Nearest-to-spot is unstable by construction. A near-zero net-GEX book crosses zero more than
  // once, and when two crossings sit at similar distance the winner is decided by where spot
  // happens to be — so a sub-0.2% move swaps them, relocating the reported flip by tens of points
  // and INVERTING `above_gamma_flip`, the long/short gamma posture the desk shows members.
  //
  // Observed live on SPX, 2026-08-19, across one session in which spot traded a 0.2% range:
  //   13:47Z null -> 14:38Z 769.15 -> 15:55Z 803.98 -> 16:34Z 809.14 -> 16:45Z 849.17 -> 17:34Z null
  // An 80-point migration and two disappearances on an underlying that barely moved. The nulls are
  // this function's `crossings_far_from_spot` branch firing once the winning crossing wandered
  // outside ±12%.
  //
  // The lowest crossing is both the textbook "zero gamma level" — cumulative dealer gamma summed
  // from the bottom of the book, at the strike it first turns positive — and, critically,
  // INDEPENDENT OF SPOT except through the plausibility window. The same book therefore yields the
  // same flip on every scan, which is the property the old rule lacked.
  //
  // Hysteresis is layered on top for the residual case: a new crossing appearing or vanishing
  // between snapshots can still move `min`, so when the caller supplies the previous flip, a
  // plausible crossing within FLIP_HYSTERESIS_PCT of it keeps the level pinned.
  const previous = opts?.previousFlip;
  if (previous != null && Number.isFinite(previous)) {
    const incumbent = plausible.find((c) => Math.abs(c - previous) <= spot * FLIP_HYSTERESIS_PCT);
    if (incumbent != null) {
      return { flip: incumbent, reason: "resolved", crossings: crossings.length, nearestCrossing: nearest };
    }
  }
  return {
    flip: plausible.reduce((lowest, c) => (c < lowest ? c : lowest)),
    reason: "resolved",
    crossings: crossings.length,
    nearestCrossing: nearest,
  };
}

export function strikeTotalsFromLadder(ladder: Map<number, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [strike, g] of ladder) {
    if (Number.isFinite(strike) && Number.isFinite(g)) out[String(strike)] = g;
  }
  return out;
}

/** UW oracle levels derived with the same sign semantics as polygon computeGexRegime. */
export function uwLevelsFromLadder(
  ladder: Map<number, number>,
  spot = 0
): { callWall: number | null; putWall: number | null; gammaFlip: number | null } {
  const strikeTotals = strikeTotalsFromLadder(ladder);
  const { callWall, putWall } = wallsFromStrikeTotals(strikeTotals);
  const gammaFlip = cumulativeGammaFlip(strikeTotals, spot);
  return { callWall, putWall, gammaFlip };
}

export type GexCrossValidationCoreResult = {
  callWallMatch: boolean;
  putWallMatch: boolean;
  flipMatch: boolean;
  divergence: number | null;
  uw: { callWall: number | null; putWall: number | null; gammaFlip: number | null };
};

const DEFAULT_STRIKE_TOLERANCE = 2;

function levelMatch(
  primary: number | null,
  oracle: number | null,
  tolerance: number
): { match: boolean; minDist: number | null } {
  if (primary == null || !Number.isFinite(primary)) return { match: false, minDist: null };
  if (oracle == null || !Number.isFinite(oracle)) return { match: false, minDist: null };
  const minDist = Math.abs(primary - oracle);
  return { match: minDist <= tolerance, minDist };
}

/**
 * Sign-aware cross-validation: compare primary call/put/flip to UW levels computed with
 * the same extrema + zero-crossing rules as the Polygon pipeline — NOT top-|GEX| strikes.
 */
export function crossValidateGexLevels(
  primary: { callWall: number | null; putWall: number | null; gammaFlip: number | null },
  ladder: Map<number, number>,
  opts?: { spot?: number; strikeTolerance?: number }
): GexCrossValidationCoreResult | null {
  if (!ladder || ladder.size === 0) return null;

  const tolerance = opts?.strikeTolerance ?? DEFAULT_STRIKE_TOLERANCE;
  const uw = uwLevelsFromLadder(ladder, opts?.spot ?? 0);

  const callResult = levelMatch(primary.callWall, uw.callWall, tolerance);
  const putResult = levelMatch(primary.putWall, uw.putWall, tolerance);
  const flipResult = levelMatch(primary.gammaFlip, uw.gammaFlip, tolerance);

  const dists = [callResult.minDist, putResult.minDist, flipResult.minDist].filter(
    (d): d is number => d != null
  );
  const divergence = dists.length > 0 ? Math.max(...dists) : null;

  return {
    callWallMatch: callResult.match,
    putWallMatch: putResult.match,
    flipMatch: flipResult.match,
    divergence,
    uw,
  };
}

/**
 * Largest positive / largest negative net-gamma strike — the call and put walls.
 *
 * Extracted so the SERVER (computeGexRegime, near-term aggregate) and the CLIENT (Thermal's
 * per-expiry Key Levels) run the identical scan. Two implementations of "the wall" that could
 * drift apart is exactly the class of bug that produced a panel where Max Pain was single-expiry
 * while every tile beside it was an aggregate — one number saying one thing, its neighbour another.
 *
 * Pure and dependency-free (this module has no imports) so it is safe in a client component.
 */
export function gexWallsFromStrikeTotals(strikeTotals: Record<string, number>): {
  callWall: number | null;
  putWall: number | null;
} {
  let callWall: number | null = null;
  let putWall: number | null = null;
  let maxPos = 0;
  let maxNeg = 0;
  for (const [s, g] of Object.entries(strikeTotals)) {
    const strike = Number(s);
    if (!Number.isFinite(strike) || !Number.isFinite(g)) continue;
    if (g > maxPos) {
      maxPos = g;
      callWall = strike;
    }
    if (g < maxNeg) {
      maxNeg = g;
      putWall = strike;
    }
  }
  return { callWall, putWall };
}

/** Regime shape — structurally identical to `GexRegime` in polygon-options-gex.ts. */
export type GexRegimeCore = {
  flip: number | null;
  posture: "long" | "short" | null;
  read: string;
};

/**
 * Posture + read for a gamma book, derived from the flip it is measured against.
 *
 * LIVES HERE BECAUSE TWO MODULES MUST AGREE AND CANNOT IMPORT EACH OTHER.
 * `polygon-options-gex.ts` imports `spx-odte-gex-uw-overlay.ts` (line 18), so the overlay can only
 * type-import back. This module has zero imports, so both can depend on it.
 *
 * THE BUG THAT MADE THIS NECESSARY. `recomputeNearTermGexStrikeTotals` re-derives strike_totals,
 * total, call_wall, put_wall and `gex.flip` after the SPX 0DTE UW ladder replaces today's column —
 * but left `gex.regime` untouched. So on SPX the served payload carried a flip from the UW-overlaid
 * book and a regime (its own `flip`, its `posture`, and its `read` sentence) describing the
 * PRE-overlay book:
 *
 *     gex.flip ........ 7893.38
 *     regime.flip ..... 7887.16
 *     regime.read ..... "Spot 7,707.98 is below the gamma flip (7,887.15) -> short gamma ..."
 *
 * Measured on prod 2026-08-20: the 6.22 pt delta held across four samples 20s apart AND through a
 * forced rebuild (`?force=1`, 9.5s), which is what ruled out caching and staleness — the overlay
 * re-runs on every request, so it re-creates the skew every time.
 *
 * `GexRegime.flip` is documented as "mirrors gex.flip". That invariant is the whole point of this
 * function: posture and read are computed FROM the flip passed in, so a caller that updates the
 * flip and calls this cannot leave a regime pointing at the old one.
 *
 * WHY POSTURE MATTERS MORE THAN THE 6 POINTS. `posture` is `spot >= flip ? long : short`, and long
 * vs short gamma inverts the entire trading interpretation — dampened and mean-reverting versus
 * amplified and trending. With spot ~180 pts below both flips the answer happened to be "short"
 * either way, which is exactly why this survived: the visible symptom was a cosmetic number
 * mismatch, while the latent failure is a wrong REGIME whenever spot sits between the two.
 */
export function buildGexRegime(input: {
  spot: number;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
}): GexRegimeCore {
  const { spot, flip, callWall, putWall } = input;
  const posture: "long" | "short" | null =
    flip != null && spot > 0 ? (spot >= flip ? "long" : "short") : null;

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

  let read: string;
  if (posture == null || flip == null || !(spot > 0)) {
    read = "Gamma flip undetermined — regime read unavailable until the chain prints a clean dealer-gamma profile.";
  } else {
    const resistance = callWall != null ? ` Resistance ${fmt(callWall)}` : "";
    const support = putWall != null ? `${resistance ? "," : ""} support ${fmt(putWall)}` : "";
    const tail = resistance || support ? `.${resistance}${support}.` : ".";
    read =
      posture === "long"
        ? `Spot ${fmt(spot)} is above the gamma flip (${fmt(flip)}) → long gamma: range-bound, fade extremes${tail}`
        : `Spot ${fmt(spot)} is below the gamma flip (${fmt(flip)}) → short gamma: momentum / vol expansion, moves accelerate${tail}`;
  }
  return { flip, posture, read };
}
