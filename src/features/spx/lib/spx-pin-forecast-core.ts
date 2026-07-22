// EOD Pin Forecaster — pure forecasting core (server-only-free, fully unit-testable).
//
// Projects the 0DTE close as a probability cone that PINCHES into the bell: dealer gamma pins price
// toward the heaviest strike as theta (charm) decays. Two engines share one drift/diffusion model:
//   • analytic  — a closed-form drift-to-magnet + implied-move cone. Cheap, instant (5s budget).
//   • montecarlo — N path simulations that recompute the dealer ladder at each step's price, so the
//     pull is PATH-DEPENDENT and the close distribution can be multi-humped ("pins 7585 OR magnets
//     to 7600") — which analytic smooths away.
//
// The BSM gamma + ladder math mirrors vector-gex-reconstruct.ts (gammaPerShare / gexLadderAtSpot);
// it is re-stated here as tiny pure functions so this core pulls no server/ws import chain. The
// cumulative gamma-flip mirrors gex-cross-validation-core.ts:cumulativeGammaFlip.

export type PinContract = {
  strike: number;
  /** YYYY-MM-DD */
  expiry: string;
  openInterest: number;
  /** Contracts traded today — live positioning built intraday (see reconstruct engine). */
  dayVolume?: number;
  iv: number;
  type: "call" | "put";
};

export type PinConeStep = { tMin: number; p10: number; p50: number; p90: number };
export type PinScenario = { close: number; p: number; kind: PinMagnetKind | "path" };
export type PinMagnetKind = "call_wall" | "put_wall" | "max_pain" | "flip";
export type PinDriver = { label: string; detail: string; weight: number };

export type PinForecast = {
  available: boolean;
  method: "analytic" | "montecarlo";
  spot: number;
  priorClose: number | null;
  timeToCloseMin: number;
  /** Modal projected close, or null when there's nothing to forecast. */
  pin: number | null;
  /** Confidence 0..1 — probability the close lands inside pinBand. Rises as the cone pinches. */
  pinPct: number | null;
  pinBand: [number, number] | null;
  pinPctOfClose: number | null;
  regime: "short_gamma" | "long_gamma" | "unknown";
  flip: number | null;
  magnet: { strike: number; kind: PinMagnetKind; direction: "up" | "down" | "flat"; strengthPct: number } | null;
  charmState: "early" | "moderate" | "accelerating";
  cone: PinConeStep[];
  scenarios: PinScenario[];
  degraded: boolean;
  degradeReason: string | null;
  /** Human-readable "why" — powers the click-to-explain detail. Ordered strongest-first. */
  drivers: PinDriver[];
};

export type PinForecastInput = {
  spot: number;
  priorClose: number | null;
  contracts: PinContract[];
  sessionYmd: string;
  /** ms since epoch for "now" and the RTH close (16:00 ET). */
  nowMs: number;
  closeMs: number;
  openMs?: number;
  /** ATM IV fallback (fraction, e.g. 0.12) if the chain is thin. */
  atmIv?: number;
  /** Recent 1-min log returns — used to detect realized ≫ implied (trend-day degrade). */
  recentReturns?: number[];
  /** Caller can force degrade (e.g. a scheduled macro event today). */
  macroEvent?: boolean;
  method?: "analytic" | "montecarlo";
  mcPaths?: number;
  mcSteps?: number;
  /** Deterministic seed (tests + reproducible production). */
  seed?: number;
};

const RTH_MIN = 390;
const YEAR_MIN = 365 * 24 * 60;
const INV_SQRT_2PI = 0.3989422804014327;
const Z90 = 1.2815515655; // 10th/90th percentile z
/** Residual-uncertainty floor for the analytic cone, as a fraction of the session's OPENING sigma.
 *  The raw diffusion sigma → 0 as time-to-close → 0, which painted the cone as a ZERO-WIDTH point at
 *  16:00 (verified live: cone[last] had p10=p50=p90) — asserting perfect certainty the model hasn't
 *  earned (settlement/auction still moves the close). Flooring sigma at ~12% of the opening sigma
 *  keeps the cone honestly narrow into the bell without collapsing to a line. Kept a hair under the
 *  confidence floor (~15%, `analytic` sigmaClose) so confidence still reads a touch tighter than the
 *  drawn cone, and well under the 35% "cone pinches into the close" contract the tests assert. */
const CONE_RESIDUAL_FRAC = 0.12;
/** Floor on the Monte-Carlo Brownian-bridge diffusion shrink: the per-step noise scales with
 *  `MC_BRIDGE_NOISE_FLOOR + (1 − floor)·tFracAt` instead of raw `tFracAt`, so late-session variance
 *  never collapses to ~0 (which over-tightened the MC cone and over-stated confidence). ~0.35 keeps
 *  honest settlement noise into the bell while the drift still pulls paths onto the pin. */
const MC_BRIDGE_NOISE_FLOOR = 0.35;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const fin = (x: number) => Number.isFinite(x);
function normPdf(x: number) { return INV_SQRT_2PI * Math.exp(-0.5 * x * x); }
/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
function normCdf(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = normPdf(x);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** BSM gamma per share (r=q=0): φ(d1)/(S·σ·√T). Mirrors vector-gex-reconstruct.gammaPerShare. */
export function bsmGamma(spot: number, strike: number, tYears: number, sigma: number): number {
  if (!(spot > 0) || !(strike > 0) || !(tYears > 0) || !(sigma > 0)) return 0;
  const sqrtT = Math.sqrt(tYears);
  const d1 = (Math.log(spot / strike) + 0.5 * sigma * sigma * tYears) / (sigma * sqrtT);
  return normPdf(d1) / (spot * sigma * sqrtT);
}

/** Net dealer GEX by strike at a spot: Σ sign·γ·OI·100·S²·0.01 (calls +, puts −).
 *
 * Positioning here is OPEN INTEREST ONLY — deliberately NOT OI + today's volume. This ladder is a
 * SIGNED quantity (calls +, puts −) and feeds the gamma-flip zero-crossing + the net-gamma regime.
 * Intraday volume is UNSIGNED (a traded contract has no dealer long/short sign), so blending it into
 * a signed cumulative sum poisons the crossing — the exact regression the Vector 0DTE path documents
 * (`vector-dte-walls-core.ts`: volume "dragged the flip from ~7,522 to ~7,000"). Keeping this OI-only
 * makes the pin's flip agree with the chart's OI-only flip (one SPX 0DTE gamma flip across the desk).
 * The OI-concentration WALLS (oiWalls) + max-pain legitimately still fold in volume — those are
 * unsigned magnitude/where-is-the-crowd measures, where intraday build is real signal. */
export function pinLadderAtSpot(contracts: readonly PinContract[], spot: number, tYears: number): Map<number, number> {
  const ladder = new Map<number, number>();
  if (!(spot > 0)) return ladder;
  for (const c of contracts) {
    const positioning = c.openInterest;
    if (!(positioning > 0) || !(c.iv > 0)) continue;
    const g = bsmGamma(spot, c.strike, tYears, c.iv);
    if (g <= 0) continue;
    const gex = (c.type === "call" ? 1 : -1) * g * positioning * 100 * spot * spot * 0.01;
    ladder.set(c.strike, (ladder.get(c.strike) ?? 0) + gex);
  }
  return ladder;
}

/** Cumulative zero-gamma flip (SpotGamma std) nearest spot, ±12% band. Mirrors cumulativeGammaFlip. */
export function pinFlip(ladder: Map<number, number>, spot: number): number | null {
  const rows = [...ladder.entries()].map(([s, g]) => ({ s, g })).filter((r) => fin(r.s) && fin(r.g)).sort((a, b) => a.s - b.s);
  if (rows.length < 2) return null;
  const crossings: number[] = [];
  let cum = 0, ps = rows[0]!.s, pc = 0;
  for (const r of rows) {
    cum += r.g;
    if (pc <= 0 && cum > 0) crossings.push(Number((ps + (-pc / (cum - pc)) * (r.s - ps)).toFixed(2)));
    ps = r.s; pc = cum;
  }
  if (!crossings.length) return null;
  if (!(spot > 0)) return crossings[crossings.length - 1]!;
  const plausible = crossings.filter((c) => Math.abs(c - spot) <= spot * 0.12);
  if (!plausible.length) return null;
  return plausible.reduce((b, c) => (Math.abs(c - spot) < Math.abs(b - spot) ? c : b));
}

/** Max-pain: strike minimising total option value paid out at expiry (standard). */
export function pinMaxPain(contracts: readonly PinContract[]): number | null {
  const strikes = [...new Set(contracts.map((c) => c.strike))].filter((s) => fin(s) && s > 0).sort((a, b) => a - b);
  if (strikes.length < 2) return null;
  let best: number | null = null, bestPain = Infinity;
  for (const K of strikes) {
    let pain = 0;
    for (const c of contracts) {
      const oi = c.openInterest + Math.max(0, c.dayVolume ?? 0);
      if (!(oi > 0)) continue;
      const itm = c.type === "call" ? Math.max(0, K - c.strike) : Math.max(0, c.strike - K);
      pain += itm * oi;
    }
    if (pain < bestPain) { bestPain = pain; best = K; }
  }
  return best;
}

/**
 * Dealer walls from OPEN-INTEREST concentration, not instantaneous gamma. At 0DTE, BSM gamma peaks
 * at ATM regardless of where the OI sits, so a pure-gamma "wall" always collapses to spot. The
 * persistent walls a trader knows (a 7,600 call wall) are big OI strikes that PIN price as it
 * approaches — exactly what max-pain captures. So: call wall = heaviest call OI at/above spot, put
 * wall = heaviest put OI at/below spot, king = heaviest total-OI strike. Positioning = OI + today's
 * volume (intraday build). Returns fractions of total OI so callers can weight magnet strength.
 */
export function oiWalls(contracts: readonly PinContract[], spot: number) {
  const byStrike = new Map<number, { call: number; put: number }>();
  let totalOi = 0;
  for (const c of contracts) {
    const oi = c.openInterest + Math.max(0, c.dayVolume ?? 0);
    if (!(oi > 0)) continue;
    totalOi += oi;
    const e = byStrike.get(c.strike) ?? { call: 0, put: 0 };
    e[c.type] += oi;
    byStrike.set(c.strike, e);
  }
  let callWall: { strike: number; oi: number } | null = null;
  let putWall: { strike: number; oi: number } | null = null;
  let king: { strike: number; oi: number } | null = null;
  for (const [strike, e] of byStrike) {
    if (strike >= spot && e.call > 0 && (!callWall || e.call > callWall.oi)) callWall = { strike, oi: e.call };
    if (strike <= spot && e.put > 0 && (!putWall || e.put > putWall.oi)) putWall = { strike, oi: e.put };
    const tot = e.call + e.put;
    if (!king || tot > king.oi) king = { strike, oi: tot };
  }
  return { callWall, putWall, king, totalOi };
}

// ── seeded RNG (mulberry32) + Box–Muller, so tests are deterministic and prod reproducible ──
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randn(rng: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

type Prep = {
  ok: boolean;
  reason: string | null;
  tMin: number;
  tFrac: number;
  /** Stable session-length tenor (years) used for the STRUCTURAL gamma ladder — flip + magnets.
   *  The OI walls are a structural feature that doesn't decay just because the clock ticks; using the
   *  shrinking time-to-close here would zero out every non-ATM strike at 0DTE and collapse the magnet
   *  to spot. Diffusion (cone width) still uses the real remaining time. */
  structYears: number;
  ladder: Map<number, number>;
  flip: number | null;
  regime: PinForecast["regime"];
  maxPain: number | null;
  magnetStrike: number | null;
  magnetKind: PinMagnetKind;
  magnetStrengthPct: number;
  direction: "up" | "down" | "flat";
  atmIv: number;
  strikeSpacing: number;
  charmState: PinForecast["charmState"];
  degraded: boolean;
  degradeReason: string | null;
};

/** Shared setup: build the ladder, flip, regime, dominant magnet, vol, charm state, degrade flags. */
function prepare(input: PinForecastInput): Prep {
  const tMin = Math.max(0, (input.closeMs - input.nowMs) / 60000);
  const tFrac = clamp(tMin / RTH_MIN, 0, 1);
  // Structural tenor for the gamma ladder = a full session, held stable all day (see Prep.structYears).
  const structYears = RTH_MIN / YEAR_MIN;
  const ladder = pinLadderAtSpot(input.contracts, input.spot, structYears);
  if (ladder.size < 2) {
    return { ok: false, reason: "chain_cold", tMin, tFrac, structYears, ladder, flip: null, regime: "unknown", maxPain: null, magnetStrike: null, magnetKind: "max_pain", magnetStrengthPct: 0, direction: "flat", atmIv: input.atmIv ?? 0.12, strikeSpacing: 5, charmState: "early", degraded: false, degradeReason: null };
  }
  // Regime from the gamma flip; when the book never turns net-long (no crossing), fall back to the
  // net-gamma sign — an honest "short everywhere" reads short, not "unknown".
  const flip = pinFlip(ladder, input.spot);
  let netGamma = 0; for (const g of ladder.values()) netGamma += g;
  const regime: PinForecast["regime"] =
    flip != null ? (input.spot >= flip ? "long_gamma" : "short_gamma") : netGamma > 0 ? "long_gamma" : netGamma < 0 ? "short_gamma" : "unknown";

  const maxPain = pinMaxPain(input.contracts);
  const { callWall, putWall, king, totalOi } = oiWalls(input.contracts, input.spot);
  const frac = (n: number | undefined) => (totalOi > 0 && n ? n / totalOi : 0);

  // Dominant magnet:
  //   • long γ  → dealers dampen → price PINS to max pain.
  //   • short γ → dealers amplify → price DRIFTS to the heavier OI wall (the dominant magnet).
  let magnetStrike: number | null = null, magnetKind: PinMagnetKind = "max_pain", magnetStrengthPct = 0;
  if (regime === "short_gamma") {
    const cwOi = callWall?.oi ?? 0, pwOi = putWall?.oi ?? 0;
    if (cwOi >= pwOi && callWall) { magnetStrike = callWall.strike; magnetKind = "call_wall"; magnetStrengthPct = frac(cwOi); }
    else if (putWall) { magnetStrike = putWall.strike; magnetKind = "put_wall"; magnetStrengthPct = frac(pwOi); }
  } else if (regime === "long_gamma" && maxPain != null) {
    magnetStrike = maxPain; magnetKind = "max_pain"; magnetStrengthPct = frac(king?.oi);
  }
  if (magnetStrike == null && maxPain != null) { magnetStrike = maxPain; magnetKind = "max_pain"; magnetStrengthPct = frac(king?.oi); }
  const direction = magnetStrike == null ? "flat" : magnetStrike > input.spot + 0.5 ? "up" : magnetStrike < input.spot - 0.5 ? "down" : "flat";

  // ATM IV
  let atmIv = input.atmIv ?? 0;
  if (!(atmIv > 0)) {
    const near = input.contracts.filter((c) => c.iv > 0).sort((a, b) => Math.abs(a.strike - input.spot) - Math.abs(b.strike - input.spot))[0];
    atmIv = near?.iv ?? 0.12;
  }
  const strikeSpacing = inferSpacing(input.contracts);
  const charmState: PinForecast["charmState"] = tFrac > 0.55 ? "early" : tFrac > 0.25 ? "moderate" : "accelerating";

  // Degrade: realized ≫ implied, or a flagged macro event → the pin model is unreliable.
  let degraded = false, degradeReason: string | null = null;
  if (input.macroEvent) { degraded = true; degradeReason = "macro_event"; }
  else if (input.recentReturns && input.recentReturns.length >= 10) {
    const rv = realizedVolAnnualized(input.recentReturns);
    if (atmIv > 0 && rv > atmIv * 1.8) { degraded = true; degradeReason = "realized_gt_implied"; }
  }
  return { ok: true, reason: null, tMin, tFrac, structYears, ladder, flip, regime, maxPain, magnetStrike, magnetKind, magnetStrengthPct, direction, atmIv, strikeSpacing, charmState, degraded, degradeReason };
}

function inferSpacing(contracts: readonly PinContract[]): number {
  const s = [...new Set(contracts.map((c) => c.strike))].filter((x) => fin(x)).sort((a, b) => a - b);
  if (s.length < 2) return 5;
  const diffs = s.slice(1).map((x, i) => x - s[i]!).filter((d) => d > 0).sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] ?? 5;
}
function realizedVolAnnualized(returns: number[]): number {
  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const varr = returns.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, n - 1);
  return Math.sqrt(varr) * Math.sqrt(YEAR_MIN); // per-minute → annualized
}

/** Charm-weighted pull fraction: how much of the spot→magnet gap closes by the bell. Grows into close. */
function pullFraction(tFrac: number, regime: PinForecast["regime"], degraded: boolean): number {
  const charm = 0.25 + 0.75 * (1 - tFrac); // 0.25 at open → 1.0 at close
  const base = regime === "short_gamma" ? 0.9 : regime === "long_gamma" ? 0.55 : 0.4;
  const pf = base * charm * (degraded ? 0.5 : 1);
  return clamp(pf, 0, 0.98);
}

function buildDrivers(p: Prep, input: PinForecastInput, medianClose: number): PinDriver[] {
  const d: PinDriver[] = [];
  if (p.flip != null) {
    d.push({
      label: p.regime === "short_gamma" ? "Short gamma below flip" : "Long gamma above flip",
      detail: p.regime === "short_gamma"
        ? `Spot ${input.spot.toFixed(0)} is below the ${p.flip.toFixed(0)} gamma flip — dealer hedging AMPLIFIES moves, so price drifts to the nearest heavy magnet.`
        : `Spot ${input.spot.toFixed(0)} is above the ${p.flip.toFixed(0)} gamma flip — dealer hedging DAMPENS moves, so price pins toward max pain.`,
      weight: 0.9,
    });
  }
  if (p.magnetStrike != null) {
    const kindLabel = p.magnetKind === "call_wall" ? "call wall" : p.magnetKind === "put_wall" ? "put wall" : "max pain";
    d.push({
      label: `${p.magnetStrike.toFixed(0)} ${kindLabel} is the dominant magnet`,
      detail: `Heaviest ${p.magnetKind === "put_wall" ? "negative" : "positive"}-gamma level ${p.direction === "up" ? "above" : p.direction === "down" ? "below" : "at"} spot (${(p.magnetStrengthPct * 100).toFixed(0)}% of |gamma|). Hedging drags price ${p.direction} into the close.`,
      weight: 0.8 * (0.5 + p.magnetStrengthPct),
    });
  }
  d.push({
    label: `Charm ${p.charmState}`,
    detail: `${p.tMin.toFixed(0)} min to close. As theta decays, gamma concentrates and the pin strengthens — the cone narrows into the bell.`,
    weight: p.charmState === "accelerating" ? 0.7 : p.charmState === "moderate" ? 0.45 : 0.25,
  });
  if (p.maxPain != null && p.magnetKind !== "max_pain") {
    d.push({ label: `Max pain ${p.maxPain.toFixed(0)} (secondary)`, detail: `Where the most option value expires worthless — a competing pull if spot loses the magnet.`, weight: 0.35 });
  }
  if (p.degraded) {
    d.push({ label: "Confidence downgraded", detail: p.degradeReason === "macro_event" ? "A macro event today can overwhelm dealer pinning — treat the pin as low-conviction." : "Realized volatility is running well above implied — the tape is trending, not pinning.", weight: 0.6 });
  }
  return d.sort((a, b) => b.weight - a.weight);
}

/** Median drift path from now → close, and the diffusion σ remaining at each step (drives the pinch). */
function medianPath(input: PinForecastInput, p: Prep, steps: number): { times: number[]; median: number[]; sigmaRemain: number[] } {
  const times: number[] = [], median: number[] = [], sigmaRemain: number[] = [];
  const target = p.magnetStrike ?? input.spot;
  // Honest residual: never let the cone pinch to a zero-width point at 16:00 (see CONE_RESIDUAL_FRAC).
  const sigFloor = input.spot * p.atmIv * Math.sqrt(Math.max(p.tMin, 1) / YEAR_MIN) * CONE_RESIDUAL_FRAC;
  for (let i = 0; i <= steps; i++) {
    const frac = i / steps; // 0 now → 1 close
    const tMinAt = p.tMin * (1 - frac);
    const tFracAt = clamp(tMinAt / RTH_MIN, 0, 1);
    const pf = pullFraction(tFracAt, p.regime, p.degraded) * frac; // cumulative pull grows to the bell
    const med = input.spot + (target - input.spot) * pf;
    const tYearsRemain = Math.max(tMinAt / YEAR_MIN, 0);
    const sig = Math.max(input.spot * p.atmIv * Math.sqrt(tYearsRemain), sigFloor);
    times.push(tMinAt); median.push(med); sigmaRemain.push(sig);
  }
  return { times, median, sigmaRemain };
}

function coneFromPath(times: number[], median: number[], sigmaRemain: number[]): PinConeStep[] {
  return times.map((tMin, i) => ({
    tMin: Number(tMin.toFixed(1)),
    p50: Number(median[i]!.toFixed(2)),
    p10: Number((median[i]! - Z90 * sigmaRemain[i]!).toFixed(2)),
    p90: Number((median[i]! + Z90 * sigmaRemain[i]!).toFixed(2)),
  }));
}

function snapBand(pin: number, spacing: number, tFrac: number): [number, number] {
  const half = Math.max(spacing / 2, spacing * (0.5 + tFrac)); // wider earlier in the session
  return [Number((pin - half).toFixed(2)), Number((pin + half).toFixed(2))];
}

function analytic(input: PinForecastInput, p: Prep): PinForecast {
  const steps = 26;
  const { times, median, sigmaRemain } = medianPath(input, p, steps);
  const medianClose = median[median.length - 1]!;
  const sigmaClose = Math.max(sigmaRemain[Math.floor(steps * 0.15)]!, input.spot * p.atmIv * Math.sqrt(Math.max(p.tMin, 1) / YEAR_MIN) * 0.15);
  // Snap the pin to the magnet if the drift lands within a band of it (real pins sit ON a strike).
  let pin = medianClose;
  if (p.magnetStrike != null && Math.abs(medianClose - p.magnetStrike) <= p.strikeSpacing) pin = p.magnetStrike;
  const band = snapBand(pin, p.strikeSpacing, p.tFrac);
  const s = Math.max(sigmaClose, 1e-6);
  const conf = clamp(normCdf((band[1] - medianClose) / s) - normCdf((band[0] - medianClose) / s), 0.02, 0.98);
  const scenarios = buildScenarios(input, p, pin, conf);
  return assemble(input, p, "analytic", pin, conf, band, coneFromPath(times, median, sigmaRemain), scenarios, medianClose);
}

function buildScenarios(input: PinForecastInput, p: Prep, pin: number, conf: number): PinScenario[] {
  const out: PinScenario[] = [{ close: Number(pin.toFixed(0)), p: Number(conf.toFixed(2)), kind: p.magnetKind }];
  if (p.maxPain != null && Math.abs(p.maxPain - pin) > p.strikeSpacing) out.push({ close: p.maxPain, p: Number((0.5 * (1 - conf)).toFixed(2)), kind: "max_pain" });
  if (p.flip != null && Math.abs(p.flip - pin) > p.strikeSpacing) out.push({ close: Number(p.flip.toFixed(0)), p: Number((0.3 * (1 - conf)).toFixed(2)), kind: "flip" });
  return out.slice(0, 4);
}

function montecarlo(input: PinForecastInput, p: Prep): PinForecast {
  const paths = clamp(input.mcPaths ?? 400, 50, 4000);
  const steps = clamp(input.mcSteps ?? 26, 6, 120);
  const rng = mulberry32((input.seed ?? 1) >>> 0);
  const dtMin = p.tMin / steps;
  const closes: number[] = [];
  // per-step samples for the empirical cone
  const stepPrices: number[][] = Array.from({ length: steps + 1 }, () => []);
  for (let pi = 0; pi < paths; pi++) {
    let price = input.spot;
    stepPrices[0]!.push(price);
    for (let s = 1; s <= steps; s++) {
      const tMinAt = p.tMin - dtMin * s;
      const tFracAt = clamp(tMinAt / RTH_MIN, 0, 1);
      // path-dependent magnet: recompute the dominant pull at THIS price, stable structural tenor
      const ladder = pinLadderAtSpot(input.contracts, price, p.structYears);
      const fl = pinFlip(ladder, price);
      const reg: PinForecast["regime"] = fl == null ? p.regime : price >= fl ? "long_gamma" : "short_gamma";
      const w = oiWalls(input.contracts, price); // OI walls relative to THIS price (path-dependent)
      const target = reg === "short_gamma"
        ? ((w.callWall?.oi ?? 0) >= (w.putWall?.oi ?? 0) && w.callWall ? w.callWall.strike : w.putWall?.strike ?? p.maxPain ?? price)
        : (p.maxPain ?? price);
      // Mean-reversion toward the magnet whose strength RAMPS UP into the close (kappa → ~0.6 near
      // expiry) — the pin gets stickier as gamma concentrates. Paired with diffusion that shrinks with
      // remaining time, this is a Brownian-bridge-style pin: paths bulge mid-session, then the
      // strengthening pull + collapsing noise re-converge them onto the pin → the cone pinches.
      const kappa = clamp(pullFraction(tFracAt, reg, p.degraded) * (0.12 + 0.88 * (1 - tFracAt)), 0, 0.6);
      const drift = (target - price) * kappa;
      // Diffusion shrink into the close: `× (BRIDGE_NOISE_FLOOR + (1-floor)·tFracAt)` rather than the
      // raw `× tFracAt`, which drove step variance to ~0 at the bell (on TOP of the √dt term) and
      // manufactured an over-tight MC cone / over-confident pin. The floor keeps honest settlement
      // noise into 16:00 so the cone stays a real distribution, not a collapsing thread — the MC
      // analogue of the analytic cone's residual-σ floor.
      const bridge = MC_BRIDGE_NOISE_FLOOR + (1 - MC_BRIDGE_NOISE_FLOOR) * tFracAt;
      const diffusion = price * p.atmIv * Math.sqrt(Math.max(dtMin, 0) / YEAR_MIN) * randn(rng) * bridge;
      price = Math.max(1, price + drift + diffusion);
      stepPrices[s]!.push(price);
    }
    closes.push(price);
  }
  closes.sort((a, b) => a - b);
  // histogram → modal bin = pin, mass in band = confidence
  const bin = p.strikeSpacing;
  const hist = new Map<number, number>();
  for (const c of closes) { const k = Math.round(c / bin) * bin; hist.set(k, (hist.get(k) ?? 0) + 1); }
  const ranked = [...hist.entries()].sort((a, b) => b[1] - a[1]);
  const pin = ranked[0]![0];
  const band = snapBand(pin, p.strikeSpacing, p.tFrac);
  const inBand = closes.filter((c) => c >= band[0] && c <= band[1]).length;
  const conf = clamp(inBand / paths, 0.02, 0.98);
  const cone: PinConeStep[] = stepPrices.map((arr, i) => {
    const a = [...arr].sort((x, y) => x - y);
    const q = (f: number) => a[clamp(Math.floor(f * (a.length - 1)), 0, a.length - 1)]!;
    return { tMin: Number((p.tMin - dtMin * i).toFixed(1)), p10: Number(q(0.1).toFixed(2)), p50: Number(q(0.5).toFixed(2)), p90: Number(q(0.9).toFixed(2)) };
  });
  const scenarios: PinScenario[] = ranked.slice(0, 4).map(([close, n], i) => ({ close, p: Number((n / paths).toFixed(2)), kind: i === 0 ? p.magnetKind : "path" }));
  return assemble(input, p, "montecarlo", pin, conf, band, cone, scenarios, cone[cone.length - 1]?.p50 ?? pin);
}

function assemble(
  input: PinForecastInput, p: Prep, method: "analytic" | "montecarlo",
  pin: number, conf: number, band: [number, number], cone: PinConeStep[], scenarios: PinScenario[], medianClose: number
): PinForecast {
  return {
    available: true, method,
    spot: input.spot, priorClose: input.priorClose, timeToCloseMin: Number(p.tMin.toFixed(1)),
    pin: Number(pin.toFixed(2)), pinPct: Number(conf.toFixed(3)),
    pinBand: band,
    pinPctOfClose: input.priorClose && input.priorClose > 0 ? Number((((pin - input.priorClose) / input.priorClose) * 100).toFixed(2)) : null,
    regime: p.regime, flip: p.flip,
    magnet: p.magnetStrike == null ? null : { strike: p.magnetStrike, kind: p.magnetKind, direction: p.direction, strengthPct: Number(p.magnetStrengthPct.toFixed(3)) },
    charmState: p.charmState,
    cone, scenarios,
    degraded: p.degraded, degradeReason: p.degradeReason,
    drivers: buildDrivers(p, input, medianClose),
  };
}

const EMPTY = (input: PinForecastInput, reason: string): PinForecast => ({
  available: false, method: input.method ?? "analytic", spot: input.spot, priorClose: input.priorClose,
  timeToCloseMin: Math.max(0, (input.closeMs - input.nowMs) / 60000), pin: null, pinPct: null, pinBand: null,
  pinPctOfClose: null, regime: "unknown", flip: null, magnet: null, charmState: "early", cone: [], scenarios: [],
  degraded: false, degradeReason: null,
  drivers: [{ label: reason === "closed" ? "Market closed" : "Collecting", detail: reason === "closed" ? "The 0DTE pin forecast runs during RTH." : "Waiting for a live 0DTE chain and session bars.", weight: 1 }],
});

/** Forecast the 0DTE close. Dispatches analytic (default) or montecarlo; never throws. */
export function forecastPin(input: PinForecastInput): PinForecast {
  if (!(input.spot > 0)) return EMPTY(input, "collecting");
  if (input.closeMs <= input.nowMs) return EMPTY(input, "closed");
  const p = prepare(input);
  if (!p.ok) return EMPTY(input, "collecting");
  return (input.method ?? "analytic") === "montecarlo" ? montecarlo(input, p) : analytic(input, p);
}
