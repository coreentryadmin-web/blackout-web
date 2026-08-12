/**
 * SYNTHETIC ORDER BOOK — the dealer hedging flow forced by a price move.
 *
 * WHAT THIS IS. A volume profile shows where trading HAS happened. This shows where trading MUST
 * happen: at every price level around spot, the quantity of stock dealers are mechanically obliged
 * to trade to stay delta-neutral if price gets there, and in which direction.
 *
 * WHY IT IS NOT THE CUMULATIVE CURVE WE ALREADY SHIP. `CumulativeCurve` accumulates TODAY's static
 * per-strike gamma across the strike axis. That treats each strike's gamma as a fixed quantity that
 * simply switches on once spot passes it. Real gamma is not fixed — it peaks at-the-money and decays
 * away, so a strike that is a monster node at spot is nearly inert 5% higher. This module therefore
 * REPRICES the whole chain at each hypothetical spot (closed-form Black-Scholes, r=q=0, the same
 * convention `polygon-options-gex.ts` uses for vanna and charm) and differences the resulting dealer
 * delta. That is the actually-correct answer, and it diverges from the cumulative proxy exactly in
 * the tails — which is where the question "what happens if we break out" gets asked.
 *
 * SIGN CONVENTION — deliberately GEX's, not DEX's. The two differ in this codebase:
 *   - GEX (`polygon-options-gex.ts`): dealer position = +1 × call OI, −1 × put OI.
 *   - DEX: dealers are the counterparty to ALL open interest, so it negates the whole book.
 * The ladder exists to explain the gamma walls and the flip, so it MUST inherit the gamma
 * convention or it would describe a different book than the levels drawn beside it. Consequence:
 * `netGammaAtSpot` here is directly comparable to the served `gex.total`, which is the single most
 * useful correctness check we have and is asserted in the tests.
 *
 * WHAT IT IS NOT — these belong in the UI, not just here:
 *   - It is NOT resting liquidity. Nothing sits on the book waiting; this is conditional, reactive
 *     flow that only occurs if price actually travels there.
 *   - It assumes dealers hedge fully and continuously. Real desks hedge in bands.
 *   - It inherits the calls-long / puts-short dealer assumption. Where that assumption is wrong for
 *     a strike, the depth is wrong there too.
 *   - IV is held FIXED across the ladder. A real 5% move moves vol as well; adding a vol axis to
 *     this same grid is the natural next step, not a correction to this one.
 *   - The closed form is EUROPEAN. Index options (SPX) genuinely are; listed equity and ETF options
 *     are AMERICAN, where early exercise moves delta slightly — most visibly on deep-ITM puts. The
 *     effect is small relative to the r=q=0 simplification above, and the anchor absorbs whatever
 *     part of it is a level error, but it is a real model limitation and not a rounding detail.
 *
 * Pure by construction: no network, no React, no Redis. Every input is passed in.
 */

/** One contract's worth of the chain — the minimum needed to reprice it at another spot. */
export interface DepthContract {
  strike: number;
  /** YYYY-MM-DD. */
  expiry: string;
  type: "call" | "put";
  openInterest: number;
  /** Decimal implied vol (0.32 = 32%), as Polygon serves it. */
  iv: number;
  /** Deliverable shares — 100 for standard listed options, different for adjusted contracts. */
  sharesPerContract?: number;
}

/** One rung: the forced hedge to traverse from the previous level into this one. */
export interface GexDepthLevel {
  /** The price at the far edge of this band. */
  price: number;
  /** Signed shares dealers must trade: positive = BUY, negative = SELL. */
  shares: number;
  /** Signed dollar notional of that trade. */
  notional: number;
  /** Signed dollars accumulated from spot out to this level — "cost to travel here". */
  cumulative: number;
  direction: "buy" | "sell" | "flat";
  /**
   * Net dealer dollar-gamma per 1% move with spot AT this price — i.e. the regime the tape would
   * be in here, not the regime it is in now. This is what makes the ladder more than a picture:
   * a level can be inside a damping bowl today and inside an accelerating slide 2% higher.
   */
  gamma: number;
}

export interface GexDepthLadder {
  spot: number;
  /** Bands ascending by price. Excludes spot itself — the view draws that axis row. */
  levels: GexDepthLevel[];
  /** Largest |notional| on the ladder, for bar scaling. 0 when the ladder is empty. */
  maxAbsNotional: number;
  /**
   * Price nearest spot where net dealer GAMMA changes sign — the repriced gamma flip, the level at
   * which a damping bowl becomes an accelerating slide. Null when the whole ladder is one regime.
   *
   * NOT derived from the flow direction, which changes at spot in EVERY long-gamma book (that is
   * just the bottom of the bowl) and would therefore report a crossing for a chain that has only
   * one regime. The tests pin this distinction.
   *
   * Related to, but not the same as, the served `gamma_flip`: that one accumulates today's static
   * per-strike gamma across the strike axis, whereas this reprices the whole book at each price.
   * Where they disagree, this is the more faithful number — see docs/audit/FINDINGS.md.
   */
  crossing: number | null;
  /** Price of the largest forced BUY / SELL band. */
  peakBuy: number | null;
  peakSell: number | null;
  /**
   * Net dealer dollar-gamma per 1% move, evaluated at spot from the repriced chain. Directly
   * comparable to the served `gex.total`; a large disagreement means our BS gamma and the
   * provider's disagree, which is worth knowing loudly.
   */
  netGammaAtSpot: number;
  /** Contracts that survived the guards and actually contributed. */
  contractsUsed: number;
  /**
   * Scale applied to every flow so gamma at spot matches the matrix's own net GEX. 1 means no
   * calibration happened — either no anchor was supplied, or the ratio was implausible and we
   * refused rather than hide a real disagreement.
   */
  calibrationFactor: number;
}

export interface DepthLadderOptions {
  /** Half-width of the ladder as a fraction of spot. Default 8%. */
  rangePct?: number;
  /** Step between rungs as a fraction of spot. Default 0.5%. */
  stepPct?: number;
  /** ET date (YYYY-MM-DD) the year-fractions are measured from. */
  todayYmd: string;
  /** When set, only these expiries contribute — pass the NEAR-TERM keep set so the ladder
   *  describes the same book the walls and flip are computed from. */
  expiries?: ReadonlySet<string>;
  /**
   * The matrix's OWN net dealer gamma at spot (`gex.total`). When supplied, the ladder is scaled so
   * its gamma at spot equals this exactly.
   *
   * WHY ANCHOR RATHER THAN TRUST OUR OWN MATH. Our closed form is r=q=0 — the same simplification
   * the shipped vanna and charm already make. The provider's greeks are not. Measured against live
   * chains on 2026-08-12 that costs almost nothing on non-payers (TSLA 0.1%, ASTS 0.7%, NVDA 1.7%)
   * and a real amount on dividend-paying ETFs (SPY 9.6%, QQQ 15.8%) — i.e. the gap IS the dividend
   * yield we are not modelling.
   *
   * Each source is then used for what it is actually best at: the provider's greeks are
   * authoritative AT spot, and repricing is the only thing that can say anything at all about other
   * prices. Anchoring also removes a whole class of "why do these two numbers disagree" question,
   * because the ladder and the headline net GEX beside it are now the same number by construction.
   *
   * Applied only when both values are finite, non-zero and of the SAME SIGN, and the ratio is
   * within CALIBRATION_BOUNDS — a wild ratio means something is actually wrong and silently
   * rescaling by 40× would hide it. The factor used is reported on the result.
   */
  anchorNetGamma?: number | null;
}

/** Sane range for the anchor scale factor. Outside this we refuse to calibrate and say so. */
const CALIBRATION_MIN = 0.4;
const CALIBRATION_MAX = 2.5;

const DEFAULT_RANGE_PCT = 0.08;
const DEFAULT_STEP_PCT = 0.005;

const INV_SQRT_2PI = 0.3989422804014327;

/** Standard normal pdf — same constant/form as the provider's, kept local so this module stays pure. */
function normPdf(x: number): number {
  return INV_SQRT_2PI * Math.exp(-0.5 * x * x);
}

/**
 * Standard normal CDF via the Zelen & Severo rational approximation (A&S 26.2.17), |error| < 7.5e-8.
 * Plenty for a hedging-flow estimate whose inputs (OI, IV) carry far more uncertainty than 1e-7.
 */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly =
    t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const p = normPdf(x) * poly;
  return x >= 0 ? 1 - p : p;
}

/**
 * Year fraction (ACT/365) from an ET date to an expiry, measured to the ~4pm ET close.
 *
 * Mirrors `yearsToExpiry` in polygon-options-gex.ts EXACTLY — same anchors, same divisor. It is
 * duplicated rather than imported on purpose: importing it would drag the provider module (Redis,
 * fetch, rate limiters) into what has to stay a pure, unit-testable function. The formulas agreeing
 * is checked indirectly and continuously by the netGammaAtSpot-vs-served-GEX comparison, which
 * would drift immediately if the two ever diverged.
 */
export function yearsToExpiry(expiry: string, todayYmd: string): number {
  const expMs = new Date(`${expiry}T16:00:00-04:00`).getTime();
  const nowMs = new Date(`${todayYmd}T00:00:00-04:00`).getTime();
  if (!Number.isFinite(expMs) || !Number.isFinite(nowMs)) return 0;
  return (expMs - nowMs) / (365 * 86_400_000);
}

/** Black-Scholes d1 at r=q=0. */
function d1Of(spot: number, strike: number, t: number, sigma: number): number {
  return (Math.log(spot / strike) + 0.5 * sigma * sigma * t) / (sigma * Math.sqrt(t));
}

/** Per-share BS delta at r=q=0. Calls 0..1, puts −1..0 (already signed by type). */
export function bsDelta(
  spot: number,
  strike: number,
  t: number,
  sigma: number,
  type: "call" | "put"
): number {
  if (!(spot > 0) || !(strike > 0) || !(t > 0) || !(sigma > 0)) return 0;
  const nd1 = normCdf(d1Of(spot, strike, t, sigma));
  const d = type === "call" ? nd1 : nd1 - 1;
  return Number.isFinite(d) ? d : 0;
}

/** Per-share BS gamma at r=q=0 — identical for calls and puts, like the provider's convention. */
export function bsGamma(spot: number, strike: number, t: number, sigma: number): number {
  if (!(spot > 0) || !(strike > 0) || !(t > 0) || !(sigma > 0)) return 0;
  const g = normPdf(d1Of(spot, strike, t, sigma)) / (spot * sigma * Math.sqrt(t));
  return Number.isFinite(g) ? g : 0;
}

/** +1 for a call, −1 for a put — the GEX dealer-position convention (see module header). */
function positionSign(type: "call" | "put"): number {
  return type === "call" ? 1 : -1;
}

/** Contracts that can actually be repriced. Anything unusable is dropped, never defaulted. */
function usable(
  contracts: readonly DepthContract[],
  todayYmd: string,
  expiries?: ReadonlySet<string>
): Array<DepthContract & { t: number; shares: number }> {
  const out: Array<DepthContract & { t: number; shares: number }> = [];
  for (const c of contracts) {
    if (expiries && !expiries.has(c.expiry)) continue;
    if (!(c.strike > 0) || !(c.openInterest > 0) || !(c.iv > 0)) continue;
    if (c.type !== "call" && c.type !== "put") continue;
    const t = yearsToExpiry(c.expiry, todayYmd);
    if (!(t > 0)) continue; // settled or malformed — contributes no gamma
    const shares =
      Number.isFinite(c.sharesPerContract) && (c.sharesPerContract ?? 0) > 0
        ? Number(c.sharesPerContract)
        : 100;
    out.push({ ...c, t, shares });
  }
  return out;
}

/**
 * Dealer option-book delta in SHARES at a hypothetical spot.
 *
 * Note this is the DEALER's own delta, not the stock hedge. The hedge is its negation: a dealer
 * holding +X delta of options must be short X shares to sit flat, which is why the ladder below
 * negates the difference to get the traded direction.
 */
export function dealerDeltaShares(
  contracts: readonly DepthContract[],
  spot: number,
  todayYmd: string,
  expiries?: ReadonlySet<string>
): number {
  if (!(spot > 0)) return 0;
  let total = 0;
  for (const c of usable(contracts, todayYmd, expiries)) {
    total += positionSign(c.type) * bsDelta(spot, c.strike, c.t, c.iv, c.type) * c.openInterest * c.shares;
  }
  return total;
}

/**
 * Net dealer dollar-gamma per 1% move at a given spot — the SAME scale the matrix's `gex.total`
 * uses (× spot² × 0.01, the SpotGamma per-1%-move convention), so the two are comparable numbers.
 */
export function netDollarGammaAt(
  contracts: readonly DepthContract[],
  spot: number,
  todayYmd: string,
  expiries?: ReadonlySet<string>
): number {
  if (!(spot > 0)) return 0;
  let total = 0;
  for (const c of usable(contracts, todayYmd, expiries)) {
    total +=
      positionSign(c.type) * bsGamma(spot, c.strike, c.t, c.iv) * c.openInterest * c.shares * spot * spot * 0.01;
  }
  return total;
}

/**
 * Build the ladder.
 *
 * For each band [Lᵢ, Lᵢ₊₁]: the dealer's option delta changes by D(Lᵢ₊₁) − D(Lᵢ), so the stock hedge
 * changes by the NEGATION of that, and that is the trade. Positive result = dealers must BUY.
 *
 * Long gamma ⇒ D rises with price ⇒ hedge falls ⇒ dealers SELL rallies and BUY dips: a bowl, which
 * damps the tape. Short gamma inverts the whole picture into a slide. That inversion is the single
 * most important thing the view communicates, and it falls out of the arithmetic rather than being
 * asserted anywhere.
 */
export function buildGexDepthLadder(
  contracts: readonly DepthContract[],
  spot: number,
  opts: DepthLadderOptions
): GexDepthLadder {
  const empty: GexDepthLadder = {
    spot: spot > 0 ? spot : 0,
    levels: [],
    maxAbsNotional: 0,
    crossing: null,
    peakBuy: null,
    peakSell: null,
    netGammaAtSpot: 0,
    contractsUsed: 0,
    calibrationFactor: 1,
  };
  if (!(spot > 0)) return empty;

  const rangePct = opts.rangePct != null && opts.rangePct > 0 ? opts.rangePct : DEFAULT_RANGE_PCT;
  const stepPct = opts.stepPct != null && opts.stepPct > 0 ? opts.stepPct : DEFAULT_STEP_PCT;
  const live = usable(contracts, opts.todayYmd, opts.expiries);
  if (live.length === 0) return empty;

  const steps = Math.max(1, Math.round(rangePct / stepPct));
  const stepUsd = spot * stepPct;

  // Cache D() per level so each price is repriced once, not twice (each level is the far edge of
  // one band and the near edge of the next).
  const priceAt = (i: number) => spot + i * stepUsd;
  const deltaCache = new Map<number, number>();
  const deltaAt = (i: number): number => {
    const hit = deltaCache.get(i);
    if (hit != null) return hit;
    const v = dealerDeltaShares(live, priceAt(i), opts.todayYmd, opts.expiries);
    deltaCache.set(i, v);
    return v;
  };

  // Anchor BEFORE building, so every reported flow, gamma and cumulative is already on the
  // matrix's scale and nothing downstream has to remember to apply a factor.
  const rawSpotGamma = netDollarGammaAt(live, spot, opts.todayYmd, opts.expiries);
  let calibrationFactor = 1;
  const anchor = opts.anchorNetGamma;
  if (
    anchor != null &&
    Number.isFinite(anchor) &&
    anchor !== 0 &&
    rawSpotGamma !== 0 &&
    anchor > 0 === rawSpotGamma > 0
  ) {
    const ratio = anchor / rawSpotGamma;
    if (ratio >= CALIBRATION_MIN && ratio <= CALIBRATION_MAX) calibrationFactor = ratio;
  }

  const gammaAt = (price: number) =>
    netDollarGammaAt(live, price, opts.todayYmd, opts.expiries) * calibrationFactor;

  const levels: GexDepthLevel[] = [];
  /** Band midpoints + their gamma, used to locate the regime crossing on the same sampling grid. */
  const mids: Array<{ price: number; gamma: number }> = [];

  // Walk outward from spot in BOTH directions so `cumulative` reads as "from spot to here" on each
  // side independently — travelling up and travelling down are separate journeys, not one axis.
  let cumUp = 0;
  for (let i = 1; i <= steps; i++) {
    const shares = -(deltaAt(i) - deltaAt(i - 1)) * calibrationFactor;
    const price = priceAt(i);
    const midPrice = price - stepUsd / 2; // the trade happens across the band, not at its edge
    const notional = shares * midPrice;
    cumUp += notional;
    // Gamma is sampled at the band MIDPOINT, the same price the notional uses. Sampling it at the
    // band's outer edge instead made `gamma` and `shares` describe different intervals, and the two
    // then disagreed on exactly one band per ticker — the one straddling the regime crossing, where
    // gamma changes sign partway across. Caught by the live harness on SPY and TSLA (31/32 bands).
    levels.push({ price, shares, notional, cumulative: cumUp, direction: "flat", gamma: gammaAt(midPrice) });
    mids.push({ price: midPrice, gamma: gammaAt(midPrice) });
  }
  let cumDown = 0;
  const below: GexDepthLevel[] = [];
  for (let i = -1; i >= -steps; i--) {
    const shares = -(deltaAt(i) - deltaAt(i + 1)) * calibrationFactor;
    const price = priceAt(i);
    const midPrice = price + stepUsd / 2;
    const notional = shares * midPrice;
    cumDown += notional;
    below.push({ price, shares, notional, cumulative: cumDown, direction: "flat", gamma: gammaAt(midPrice) });
    mids.push({ price: midPrice, gamma: gammaAt(midPrice) });
  }

  const all = [...below.reverse(), ...levels]; // ascending by price

  const maxAbsNotional = all.reduce((m, l) => Math.max(m, Math.abs(l.notional)), 0);
  // A band is "flat" only when it is negligible against the biggest band on screen — an absolute
  // epsilon would call a whole quiet ladder flat, and a pure `=== 0` test would call float dust real.
  const eps = maxAbsNotional * 1e-4;
  for (const l of all) l.direction = l.notional > eps ? "buy" : l.notional < -eps ? "sell" : "flat";

  let peakBuy: number | null = null;
  let peakSell: number | null = null;
  let bestBuy = 0;
  let bestSell = 0;
  for (const l of all) {
    if (l.notional > bestBuy) {
      bestBuy = l.notional;
      peakBuy = l.price;
    }
    if (l.notional < bestSell) {
      bestSell = l.notional;
      peakSell = l.price;
    }
  }

  // Regime crossing nearest spot: where net dealer GAMMA changes sign — bowl becomes slide.
  // Interpolated between the two straddling rungs. See the `crossing` doc comment for why this is
  // computed from gamma and NOT from the flow direction.
  let crossing: number | null = null;
  let bestDist = Infinity;
  mids.sort((x, y) => x.price - y.price);
  for (let i = 1; i < mids.length; i++) {
    const a = mids[i - 1]!;
    const b = mids[i]!;
    if (a.gamma === 0 || b.gamma === 0) continue;
    if (a.gamma > 0 === b.gamma > 0) continue;
    const span = b.gamma - a.gamma;
    const at = span === 0 ? a.price : a.price + (-a.gamma / span) * (b.price - a.price);
    const dist = Math.abs(at - spot);
    if (dist < bestDist) {
      bestDist = dist;
      crossing = Number(at.toFixed(2));
    }
  }

  return {
    spot,
    levels: all,
    maxAbsNotional,
    crossing,
    peakBuy,
    peakSell,
    netGammaAtSpot: rawSpotGamma * calibrationFactor,
    contractsUsed: live.length,
    calibrationFactor,
  };
}

/**
 * Which ladder band contains `price`?
 *
 * The matrix draws one row per LISTED STRIKE — irregular spacing straight off the chain (ASTS
 * lists $0.50 steps near spot and $5 steps in the tails). The ladder is a regular %-grid. To pin a
 * forced-flow rail beside the matrix, every strike row has to resolve to the band it falls inside,
 * and a strike outside the ladder's range must resolve to NOTHING rather than being clamped to the
 * nearest edge — clamping would paint the outermost band's flow onto every far strike, which reads
 * as a wall of forced trading exactly where there is none.
 *
 * Band geometry follows the builder: level `i` above spot covers `(spot+(i-1)·step, spot+i·step]`,
 * level `i` below covers `[spot+i·step, spot+(i+1)·step)`. Spot itself belongs to no band — it is
 * the axis, and the view draws it as its own row.
 *
 * Generic over the level shape so it works on both the in-memory ladder and the serialized payload.
 */
export function depthBandForPrice<T extends { price: number }>(
  levels: readonly T[],
  spot: number,
  price: number
): T | null {
  if (!(spot > 0) || !Number.isFinite(price) || levels.length < 2) return null;
  if (price === spot) return null;

  // Derive the step from the grid itself rather than taking it as a parameter — the caller may
  // only hold the serialized levels, and a step passed separately is a chance for the two to drift.
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  let step = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i]!.price - sorted[i - 1]!.price;
    if (gap > 1e-9 && gap < step) step = gap;
  }
  if (!Number.isFinite(step) || step <= 0) return null;

  // EXACT band containment, not "nearest level". Nearest ties at a band boundary — a price at
  // spot+0.75·step is equidistant from the bands either side of it — and the tie resolved to the
  // wrong one, so the rail drew a strike's flow one band off. Containment has no ties.
  //   above spot: level p covers (p − step, p]
  //   below spot: level p covers [p, p + step)
  const EPS = step * 1e-9;
  for (const l of sorted) {
    if (l.price > spot) {
      if (price > l.price - step + EPS && price <= l.price + EPS) return l;
    } else if (l.price < spot) {
      if (price >= l.price - EPS && price < l.price + step - EPS) return l;
    }
  }
  // Outside every band — the price is off the ladder. Deliberately NOT clamped to the nearest
  // edge: clamping would paint the outermost band's flow onto every far strike, reading as a wall
  // of forced trading exactly where there is none.
  return null;

}
