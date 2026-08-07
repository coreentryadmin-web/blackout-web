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
  /** Modal projected close SNAPPED to the dominant magnet strike (real pins sit ON a strike), or
   *  null when there's nothing to forecast. This is the discrete "pin target". */
  pin: number | null;
  /** UNSNAPPED live projected close — the median drift path's terminal value (analytic) or the
   *  empirical median of the simulated closes (MC), before the snap-to-strike. Moves continuously
   *  with spot/drift intraday, so it's the "live" number to headline; `pin` is the strike it rounds
   *  to. On a quiet pinning day the two nearly coincide; on a trending day projectedClose leads. */
  projectedClose: number | null;
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
  /** Provenance: TRUE when the ATM IV that sizes the whole cone was neither supplied
   *  (`input.atmIv`) nor readable from any chain contract, so the hardcoded 12% guess
   *  was used. Numbers are unchanged — this flag just lets the UI mark a forecast whose
   *  vol input is a fallback, not observed, so a guessed-IV cone reads differently from a
   *  real-IV one. Distinct from `degraded` (which flags an unreliable REGIME, not a
   *  guessed input). */
  ivFallback: boolean;
  /**
   * Provenance: TRUE when the magnet sits further from spot than the name's own remaining implied
   * move, so the pull target was bounded to {@link MAGNET_MAX_SIGMA}σ (see `boundMagnetTarget`).
   *
   * `magnet.strike` still reports the REAL magnet — this flag says the forecast declined to project
   * all the way there because the option market does not price price getting that far by the target.
   * Same spirit as `ivFallback`: the numbers are honest, and the UI gets to mark WHY they are what
   * they are. A member seeing a magnet far below spot but a projection that barely moves is looking
   * at a coherent forecast, not a broken one, and this is the field that says so.
   */
  magnetClamped: boolean;
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
  /**
   * Length of the FORECAST WINDOW in minutes — the span the cone's progress fraction is measured
   * against, i.e. "how long is the run-up to this target". Defaults to `RTH_MIN` (one 390-min RTH
   * session), which is the only horizon the SPX 0DTE desk ever asks for.
   *
   * Why this is an input and not the constant it used to be: `tFrac = tMin / RTH_MIN` is the
   * model's charm clock — it drives `charmState`, the magnet pull ramp, and the MC bridge's noise
   * decay. Hardcoding 390 is correct ONLY when the target is today's close. Point the same model at
   * a Friday expiry three days out and `tMin ≈ 4,000`, so `tFrac` clamps to 1.0 for two and a half
   * days: the forecast would report "early, no pinning yet" right up until the final session, then
   * lurch. Passing the real window length makes the charm ramp span the actual run-up to expiry.
   */
  horizonMin?: number;
  /**
   * Structural tenor (YEARS) for the gamma ladder — see {@link Prep.structYears} for why the ladder
   * uses a stable tenor rather than shrinking time-to-close. Defaults to one session
   * (`RTH_MIN / YEAR_MIN`).
   *
   * This must track the TARGET EXPIRY, not the clock: BSM gamma goes as 1/√T, so pricing a
   * 3-day-out book at a 390-minute tenor overstates gamma concentration by ~√(3·390/390) ≈ 1.7x and
   * manufactures walls sharper than the book actually has. A caller forecasting to a non-0DTE
   * expiry MUST pass the real years-to-expiry.
   */
  structYears?: number;
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
/**
 * Hard bound on how far the magnet may displace the forecast from spot, in units of the name's OWN
 * remaining 1σ options-implied move (`spot · atmIv · √(tMin/YEAR)` — the same quantity
 * `computeExpectedMove` serves on the expected-move route, from the same chain and the same spot).
 *
 * WHY A BOUND AT ALL. The magnet pull is a DRIFT inside a diffusion; the diffusion's own scale is the
 * only physical yardstick the model has for "how far can this name travel by the target". Without a
 * bound the pull is free to place the modal close anywhere the OI ladder points, which is how the
 * forecast came to assert a NVDA close 4.10% below spot — outside NVDA's own **2σ** band — on
 * 2026-08-07. Two surfaces of the same product, built from the same chain at the same second, flatly
 * contradicted each other.
 *
 * WHY 2σ. This is the criterion the live evidence actually produced: the NVDA forecast's projected
 * close sat outside the name's own **2σ** band, which is what made the two surfaces contradict each
 * other. 2σ (~95% of the implied distribution) is the edge of what the option market treats as the
 * plausible range at all — a modal forecast beyond it is calling a tail as its base case.
 *
 * A tighter 1σ bound was tried first and REJECTED on evidence, not taste: it also clamps the shipped
 * SPX fixture, whose call wall sits ~78 pts from spot against a ~40 pt session σ. SPX/SPY/QQQ/AMD/
 * META all pinned correctly on 2026-08-07, so a bound that fires on them is not separating the
 * pathology from healthy pinning — it is just a smaller number. Pinning to a wall beyond 1σ is a
 * real, observed phenomenon; pinning beyond 2σ is not.
 *
 * This does NOT relocate the magnet: `magnet.strike` still reports the true, independently-verified
 * OI/max-pain level (NVDA's 207.5 was corroborated exactly against Polygon). It bounds only how far
 * the projection is allowed to be dragged toward it, and sets `magnetClamped` so the UI can say so.
 */
const MAGNET_MAX_SIGMA = 2.0;
/**
 * Ceiling on `pinPct` as a multiple of the options-implied probability of the SAME band.
 *
 * `pinPct` is `inBand / paths` (MC) or the normal mass over the band (analytic) — in both cases a
 * measurement of the MODEL'S OWN path bundle, which the mean-reversion drift deliberately squeezes.
 * That makes it a measure of the model's internal tightness, not of how reliable the forecast is,
 * and it saturated its 0.98 clamp on 2 of 7 names on the endpoint's first live day. NVDA sat at
 * exactly 98% across three samples spanning 18 minutes while its own pin moved 2.5 points — a number
 * that certain about a close should not be able to relocate that close without flinching.
 *
 * Anchoring the ceiling to the implied distribution makes the forecast's confidence commensurable
 * with the expected-move surface it sits next to. The 2× headroom is the pin effect's allowance:
 * pinning genuinely does concentrate settlement onto strikes, so the forecast is allowed to claim up
 * to twice the probability pure diffusion assigns that range — but no more. That multiplier is an
 * honest BOUND, not a calibration: nothing here has yet been measured against realized closes, and
 * it should be replaced by a fitted value once the forecast has an outcome record to fit against.
 */
const PIN_CONF_IMPLIED_MULT = 2;

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
 *
 * Wall pick is DISTANCE-WEIGHTED (`oi / (1 + |K−S|/spacing)`), not raw max OI. Live 2026-07-29: a
 * fragmented 0DTE book made a thin put wall at 7300 (~3% of OI, −120pts) beat nearer strikes on raw
 * OI alone → the forecaster yanked projected close ∼110pts and sat frozen all afternoon. Nearer denser
 * walls must win; far thin walls become soft secondary magnets via magnetPullScale.
 */
export function oiWalls(contracts: readonly PinContract[], spot: number, spacing = 5) {
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
  const sp = Math.max(spacing, 1);
  const score = (oi: number, strike: number) => oi / (1 + Math.abs(strike - spot) / sp);
  let callWall: { strike: number; oi: number } | null = null;
  let putWall: { strike: number; oi: number } | null = null;
  let king: { strike: number; oi: number } | null = null;
  let callScore = -1, putScore = -1;
  for (const [strike, e] of byStrike) {
    if (strike >= spot && e.call > 0) {
      const sc = score(e.call, strike);
      if (sc > callScore) { callScore = sc; callWall = { strike, oi: e.call }; }
    }
    if (strike <= spot && e.put > 0) {
      const sc = score(e.put, strike);
      if (sc > putScore) { putScore = sc; putWall = { strike, oi: e.put }; }
    }
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
  /** Resolved forecast-window length (minutes) — `input.horizonMin` or the RTH_MIN default. The
   *  cone builders measure their per-step progress against THIS, never the bare constant. */
  horizonMin: number;
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
  /** TRUE when atmIv fell through to the hardcoded 12% guess (no input + no chain IV). */
  ivFallback: boolean;
};

/** Shared setup: build the ladder, flip, regime, dominant magnet, vol, charm state, degrade flags. */
function prepare(input: PinForecastInput): Prep {
  const tMin = Math.max(0, (input.closeMs - input.nowMs) / 60000);
  // Forecast window + structural tenor. Both default to ONE RTH SESSION, which is what the SPX 0DTE
  // desk has always asked for, so an SPX caller that passes neither gets byte-identical numbers to
  // before these became inputs. A caller targeting a further-out expiry must pass both (see
  // PinForecastInput.horizonMin / .structYears for what goes wrong if it doesn't).
  const horizonMin = input.horizonMin != null && input.horizonMin > 0 ? input.horizonMin : RTH_MIN;
  const tFrac = clamp(tMin / horizonMin, 0, 1);
  const structYears =
    input.structYears != null && input.structYears > 0 ? input.structYears : RTH_MIN / YEAR_MIN;
  const ladder = pinLadderAtSpot(input.contracts, input.spot, structYears);
  if (ladder.size < 2) {
    return { ok: false, reason: "chain_cold", tMin, tFrac, horizonMin, structYears, ladder, flip: null, regime: "unknown", maxPain: null, magnetStrike: null, magnetKind: "max_pain", magnetStrengthPct: 0, direction: "flat", atmIv: input.atmIv ?? 0.12, strikeSpacing: 5, charmState: "early", degraded: false, degradeReason: null, ivFallback: !(input.atmIv != null && input.atmIv > 0) };
  }
  // Regime from the gamma flip; when the book never turns net-long (no crossing), fall back to the
  // net-gamma sign — an honest "short everywhere" reads short, not "unknown".
  const flip = pinFlip(ladder, input.spot);
  let netGamma = 0; for (const g of ladder.values()) netGamma += g;
  const regime: PinForecast["regime"] =
    flip != null ? (input.spot >= flip ? "long_gamma" : "short_gamma") : netGamma > 0 ? "long_gamma" : netGamma < 0 ? "short_gamma" : "unknown";

  const strikeSpacing = inferSpacing(input.contracts);
  const maxPain = pinMaxPain(input.contracts);
  const { callWall, putWall, king, totalOi } = oiWalls(input.contracts, input.spot, strikeSpacing);
  const frac = (n: number | undefined) => (totalOi > 0 && n ? n / totalOi : 0);

  // Dominant magnet:
  //   • long γ  → dealers dampen → price PINS to max pain.
  //   • short γ → dealers amplify → price DRIFTS to the heavier OI wall (the dominant magnet).
  // Walls are already distance-weighted (oiWalls). Still: a fragmented book can leave the "winner"
  // with <<5% of total OI — in that case prefer max pain (a structural close magnet) over yanking
  // the projection toward a thin far wall (live 2026-07-29: 3% put wall @ 7300 vs spot ~7420).
  const WEAK_WALL_PCT = 0.05;
  let magnetStrike: number | null = null, magnetKind: PinMagnetKind = "max_pain", magnetStrengthPct = 0;
  if (regime === "short_gamma") {
    // Compare walls on the SAME distance-weighted score the picker used, not raw OI — otherwise a
    // far heavy wall still beats a nearer denser one at the magnet-choice step.
    const cwScore = callWall ? callWall.oi / (1 + Math.abs(callWall.strike - input.spot) / Math.max(strikeSpacing, 1)) : 0;
    const pwScore = putWall ? putWall.oi / (1 + Math.abs(putWall.strike - input.spot) / Math.max(strikeSpacing, 1)) : 0;
    if (cwScore >= pwScore && callWall) { magnetStrike = callWall.strike; magnetKind = "call_wall"; magnetStrengthPct = frac(callWall.oi); }
    else if (putWall) { magnetStrike = putWall.strike; magnetKind = "put_wall"; magnetStrengthPct = frac(putWall.oi); }
    if (
      magnetStrike != null &&
      magnetStrengthPct < WEAK_WALL_PCT &&
      maxPain != null &&
      Math.abs(maxPain - input.spot) <= Math.abs(magnetStrike - input.spot)
    ) {
      magnetStrike = maxPain;
      magnetKind = "max_pain";
      magnetStrengthPct = frac(king?.oi);
    }
  } else if (regime === "long_gamma" && maxPain != null) {
    magnetStrike = maxPain; magnetKind = "max_pain"; magnetStrengthPct = frac(king?.oi);
  }
  if (magnetStrike == null && maxPain != null) { magnetStrike = maxPain; magnetKind = "max_pain"; magnetStrengthPct = frac(king?.oi); }
  const direction = magnetStrike == null ? "flat" : magnetStrike > input.spot + 0.5 ? "up" : magnetStrike < input.spot - 0.5 ? "down" : "flat";

  // ATM IV. Track whether we end up on the hardcoded 12% guess so the forecast can be
  // badged as vol-fallback: real IV missing means the whole cone width is a guess.
  let atmIv = input.atmIv ?? 0;
  let ivFallback = false;
  if (!(atmIv > 0)) {
    const near = input.contracts.filter((c) => c.iv > 0).sort((a, b) => Math.abs(a.strike - input.spot) - Math.abs(b.strike - input.spot))[0];
    if (near?.iv != null && near.iv > 0) {
      atmIv = near.iv;
    } else {
      atmIv = 0.12;
      ivFallback = true;
    }
  }
  const charmState: PinForecast["charmState"] = tFrac > 0.55 ? "early" : tFrac > 0.25 ? "moderate" : "accelerating";

  // Degrade: realized ≫ implied, or a flagged macro event → the pin model is unreliable.
  let degraded = false, degradeReason: string | null = null;
  if (input.macroEvent) { degraded = true; degradeReason = "macro_event"; }
  else if (input.recentReturns && input.recentReturns.length >= 10) {
    const rv = realizedVolAnnualized(input.recentReturns);
    if (atmIv > 0 && rv > atmIv * 1.8) { degraded = true; degradeReason = "realized_gt_implied"; }
  }
  return { ok: true, reason: null, tMin, tFrac, horizonMin, structYears, ladder, flip, regime, maxPain, magnetStrike, magnetKind, magnetStrengthPct, direction, atmIv, strikeSpacing, charmState, degraded, degradeReason, ivFallback };
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

/**
 * Scale dealer pull by magnet mass. A 3% OI wall must not drag like a 20% wall — that was the
 * "projected close frozen 120pts below spot" live bug (2026-07-29). ≥∼15% OI → full pull; thin
 * walls keep a soft residual drift so the cone still breathes with spot.
 */
export function magnetPullScale(strengthPct: number): number {
  return clamp(0.12 + Math.max(0, strengthPct) * 5.5, 0.12, 1);
}

/**
 * The name's own remaining 1σ options-implied move, in price points: `spot · σ · √t`.
 *
 * This is BYTE-FOR-BYTE the quantity `computeExpectedMove` serves on `/api/market/vector/expected-move`
 * (`vector-expected-move.ts:69`) — same lognormal-diffusion displacement, same calendar annualization
 * — just expressed in minutes because that is the clock this model carries. Sharing the definition is
 * the point: it is what makes the two Vector surfaces commensurable instead of contradictory.
 */
export function remainingSigma(spot: number, atmIv: number, tMin: number): number {
  if (!(spot > 0) || !(atmIv > 0)) return 0;
  return spot * atmIv * Math.sqrt(Math.max(tMin, 0) / YEAR_MIN);
}

/**
 * Bound a magnet target to {@link MAGNET_MAX_SIGMA} of the remaining implied move from spot.
 *
 * Returns the ORIGINAL target untouched whenever it already sits inside the cone — which is the
 * common case, and why this changes nothing for the names that were behaving (SPX/SPY/QQQ/AMD/META
 * all pinned within a few points of spot on 2026-08-07). It bites only on the pathology it exists
 * for: a correctly-identified magnet that happens to sit further away than the name can plausibly
 * travel by the target.
 *
 * `sigma <= 0` (no vol, no time) returns the target unchanged rather than collapsing it to spot —
 * with no implied distribution there is no bound to apply, and silently pinning every path to spot
 * would be a fabricated forecast rather than an absent one.
 */
export function boundMagnetTarget(
  spot: number,
  target: number,
  sigma: number,
  maxSigma = MAGNET_MAX_SIGMA
): { target: number; clamped: boolean } {
  if (!fin(spot) || !fin(target) || !(sigma > 0)) return { target, clamped: false };
  const maxDisp = maxSigma * sigma;
  const disp = target - spot;
  if (Math.abs(disp) <= maxDisp) return { target, clamped: false };
  return { target: spot + Math.sign(disp) * maxDisp, clamped: true };
}

/**
 * Probability the options-implied distribution assigns to `band` — the reference `pinPct` is capped
 * against (see {@link PIN_CONF_IMPLIED_MULT}). Normal about spot with σ = the remaining implied move;
 * the same symmetric convention `computeExpectedMove` uses for its quoted bands, so a member
 * comparing the two numbers on one chart is comparing like with like.
 */
export function impliedBandProbability(spot: number, band: readonly [number, number], sigma: number): number {
  if (!(sigma > 0)) return 1; // no distribution to test against → impose no ceiling
  return clamp(normCdf((band[1] - spot) / sigma) - normCdf((band[0] - spot) / sigma), 0, 1);
}

/** Charm-weighted pull fraction: how much of the spot→magnet gap closes by the bell. Grows into close. */
function pullFraction(
  tFrac: number,
  regime: PinForecast["regime"],
  degraded: boolean,
  strengthPct = 1
): number {
  const charm = 0.25 + 0.75 * (1 - tFrac); // 0.25 at open → 1.0 at close
  const base = regime === "short_gamma" ? 0.9 : regime === "long_gamma" ? 0.55 : 0.4;
  const pf = base * charm * magnetPullScale(strengthPct) * (degraded ? 0.5 : 1);
  return clamp(pf, 0, 0.98);
}

function buildDrivers(p: Prep, input: PinForecastInput, medianClose: number): PinDriver[] {
  const d: PinDriver[] = [];
  if (p.flip != null) {
    d.push({
      label: p.regime === "short_gamma" ? "Short gamma below flip" : "Long gamma above flip",
      detail: p.regime === "short_gamma"
        ? `Spot ${input.spot.toFixed(0)} is below the ${p.flip.toFixed(0)} gamma flip — dealer hedging AMPLIFIES moves, so price drifts to the nearest heavy magnet.`
        : `Spot ${input.spot.toFixed(0)} is above the ${p.flip.toFixed(0)} gamma flip — dealer hedging DAMPENS moves, so price pins toward effective max pain (open interest + today's volume).`,
      weight: 0.9,
    });
  }
  if (p.magnetStrike != null) {
    // "effective max pain", not "max pain" — the two are DIFFERENT METRICS and both are correct.
    //
    // pinMaxPain (:200) weights by `openInterest + max(0, dayVolume)`, i.e. it folds TODAY'S traded
    // volume into the pin estimate. The desk header's MAX PAIN tile reports classic OI-ONLY max
    // pain. Live 2026-08-07 they read 7700 and 7630 — 70 points apart, same instant, both
    // member-facing, both labelled "max pain". Independently verified against the full Polygon SPXW
    // chain (336 contracts, spot 7739.37 at 13:48:13Z): OI-only = 7630 (matches the header EXACTLY),
    // OI+volume = 7680, drifting to 7700 as volume accrued. Neither is wrong; the shared LABEL was.
    //
    // Renaming here rather than changing the arithmetic is deliberate — the volume-weighted figure
    // is the better INTRADAY pin estimator (it is what the magnet actually tracked all session),
    // and the audit's Polygon cross-check confirmed the forecast's magnet location to the strike.
    const kindLabel =
      p.magnetKind === "call_wall" ? "call wall" : p.magnetKind === "put_wall" ? "put wall" : "effective max pain";
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
    d.push({
      label: `Effective max pain ${p.maxPain.toFixed(0)} (secondary)`,
      // Says WHICH max pain, so a member comparing this to the header tile knows why they differ.
      detail: `Where the most option value expires worthless, weighted by open interest PLUS today's traded volume — so it can sit away from the header's open-interest-only MAX PAIN. A competing pull if spot loses the magnet.`,
      weight: 0.35,
    });
  }
  if (p.degraded) {
    d.push({ label: "Confidence downgraded", detail: p.degradeReason === "macro_event" ? "A macro event today can overwhelm dealer pinning — treat the pin as low-conviction." : "Realized volatility is running well above implied — the tape is trending, not pinning.", weight: 0.6 });
  }
  return d.sort((a, b) => b.weight - a.weight);
}

/** Median drift path from now → close, and the diffusion σ remaining at each step (drives the pinch). */
function medianPath(
  input: PinForecastInput,
  p: Prep,
  steps: number
): { times: number[]; median: number[]; sigmaRemain: number[]; magnetClamped: boolean } {
  const times: number[] = [], median: number[] = [], sigmaRemain: number[] = [];
  // Bound the pull target to the name's own implied cone (MAGNET_MAX_SIGMA). Computed ONCE, against
  // the session's spot and the FULL remaining time — not per step against the drifting price, which
  // would let the projection ratchet its way to an arbitrarily distant magnet one bounded hop at a
  // time and reintroduce exactly the bug this bound exists to stop.
  const bounded = boundMagnetTarget(
    input.spot,
    p.magnetStrike ?? input.spot,
    remainingSigma(input.spot, p.atmIv, p.tMin)
  );
  const target = bounded.target;
  // Honest residual: never let the cone pinch to a zero-width point at 16:00 (see CONE_RESIDUAL_FRAC).
  const sigFloor = input.spot * p.atmIv * Math.sqrt(Math.max(p.tMin, 1) / YEAR_MIN) * CONE_RESIDUAL_FRAC;
  for (let i = 0; i <= steps; i++) {
    const frac = i / steps; // 0 now → 1 close
    const tMinAt = p.tMin * (1 - frac);
    const tFracAt = clamp(tMinAt / p.horizonMin, 0, 1);
    // Strength-scaled: thin magnets leave most of the path with spot so the projection MOVES live.
    const pf = pullFraction(tFracAt, p.regime, p.degraded, p.magnetStrengthPct) * frac;
    const med = input.spot + (target - input.spot) * pf;
    const tYearsRemain = Math.max(tMinAt / YEAR_MIN, 0);
    const sig = Math.max(input.spot * p.atmIv * Math.sqrt(tYearsRemain), sigFloor);
    times.push(tMinAt); median.push(med); sigmaRemain.push(sig);
  }
  return { times, median, sigmaRemain, magnetClamped: bounded.clamped };
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
  const { times, median, sigmaRemain, magnetClamped } = medianPath(input, p, steps);
  const medianClose = median[median.length - 1]!;
  const sigmaClose = Math.max(sigmaRemain[Math.floor(steps * 0.15)]!, input.spot * p.atmIv * Math.sqrt(Math.max(p.tMin, 1) / YEAR_MIN) * 0.15);
  // Snap the pin to the magnet if the drift lands within a band of it (real pins sit ON a strike).
  let pin = medianClose;
  if (p.magnetStrike != null && Math.abs(medianClose - p.magnetStrike) <= p.strikeSpacing) pin = p.magnetStrike;
  const band = snapBand(pin, p.strikeSpacing, p.tFrac);
  const s = Math.max(sigmaClose, 1e-6);
  const raw = normCdf((band[1] - medianClose) / s) - normCdf((band[0] - medianClose) / s);
  const conf = calibrateConfidence(raw, input.spot, band, remainingSigma(input.spot, p.atmIv, p.tMin));
  const scenarios = buildScenarios(input, p, pin, conf);
  return assemble(input, p, "analytic", pin, conf, band, coneFromPath(times, median, sigmaRemain), scenarios, medianClose, magnetClamped);
}

/**
 * Cap a raw model confidence at {@link PIN_CONF_IMPLIED_MULT}× the options-implied probability of the
 * SAME band, then apply the existing 0.02/0.98 clamp.
 *
 * The raw figure measures the model's own path bundle, whose dispersion the mean-reversion drift
 * deliberately squeezes — so it rises as the drift assumption gets more aggressive, which is exactly
 * backwards. Anchoring it to the implied distribution means an over-tight bundle can no longer
 * manufacture certainty: to claim a high probability the band must also be somewhere the option
 * market thinks price can actually finish.
 *
 * Live 2026-08-07 09:58:30 ET, NVDA — band 211.43..218.57, spot 222.03, 1σ 2.71:
 * implied P(close in band) = 10.1%, served pinPct = 98%. A 9.7× overstatement from two surfaces of
 * one product at one second. Under this cap that band cannot exceed 20.2%.
 */
function calibrateConfidence(raw: number, spot: number, band: readonly [number, number], sigma: number): number {
  const ceiling = PIN_CONF_IMPLIED_MULT * impliedBandProbability(spot, band, sigma);
  return clamp(Math.min(raw, ceiling), 0.02, 0.98);
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
  // The implied cone this whole simulation is bounded by — one value for the run, measured from the
  // session spot over the full remaining time (see boundMagnetTarget for why it is not per-step).
  const sigmaFull = remainingSigma(input.spot, p.atmIv, p.tMin);
  // `magnetClamped` reports the HEADLINE magnet — the one the desk reads off `magnet.strike` — not
  // "did any of the paths×steps per-step wall targets get bounded". The per-step targets are
  // path-dependent (recomputed at each path's drifted price), so over 400×26 evaluations at least
  // one is essentially always beyond the bound and a flag raised off that would be permanently true
  // and tell a member nothing. This is the same one-shot test the analytic branch reports.
  const headlineClamped = boundMagnetTarget(input.spot, p.magnetStrike ?? input.spot, sigmaFull).clamped;
  const closes: number[] = [];
  // per-step samples for the empirical cone
  const stepPrices: number[][] = Array.from({ length: steps + 1 }, () => []);
  for (let pi = 0; pi < paths; pi++) {
    let price = input.spot;
    stepPrices[0]!.push(price);
    for (let s = 1; s <= steps; s++) {
      const tMinAt = p.tMin - dtMin * s;
      const tFracAt = clamp(tMinAt / p.horizonMin, 0, 1);
      // path-dependent magnet: recompute the dominant pull at THIS price, stable structural tenor
      const ladder = pinLadderAtSpot(input.contracts, price, p.structYears);
      const fl = pinFlip(ladder, price);
      const reg: PinForecast["regime"] = fl == null ? p.regime : price >= fl ? "long_gamma" : "short_gamma";
      const w = oiWalls(input.contracts, price, p.strikeSpacing); // OI walls relative to THIS price (path-dependent)
      const sp = Math.max(p.strikeSpacing, 1);
      const cwScore = w.callWall ? w.callWall.oi / (1 + Math.abs(w.callWall.strike - price) / sp) : 0;
      const pwScore = w.putWall ? w.putWall.oi / (1 + Math.abs(w.putWall.strike - price) / sp) : 0;
      let rawTarget = p.maxPain ?? price;
      // `wallOi = null` means "this step is NOT pulling toward an OI wall" — i.e. the target is max
      // pain, whose strength the prep layer already measured as `p.magnetStrengthPct`. The previous
      // `let wallOi = 0` conflated that with "the wall has zero open interest": `wallOi` was only ever
      // ASSIGNED inside the short_gamma branch, so on any long-gamma name `strengthPct` came out
      // `0 / totalOi = 0`, and the intended fallback to the real prep-computed strength was reachable
      // only on a chain with zero total OI — i.e. never. Every long-gamma name therefore ran the whole
      // simulation at magnetPullScale's 0.12 floor regardless of how strong its magnet actually was.
      // Verified live 2026-08-07: NVDA's response carried magnet.strengthPct 0.23 while the MC that
      // moved price used 0, reproducible offline to the cent (projectedClose 212.76).
      let wallOi: number | null = null;
      if (reg === "short_gamma") {
        if (cwScore >= pwScore && w.callWall) { rawTarget = w.callWall.strike; wallOi = w.callWall.oi; }
        else if (w.putWall) { rawTarget = w.putWall.strike; wallOi = w.putWall.oi; }
      }
      // Bound each step's pull target to the implied cone measured from the SESSION spot (not the
      // path's current price) — see boundMagnetTarget. Anchoring to the path price would let a path
      // walk to a distant magnet in bounded hops, which is the unbounded behaviour in disguise.
      const target = boundMagnetTarget(input.spot, rawTarget, sigmaFull).target;
      // Strength that belongs to the magnet ACTUALLY being targeted: the wall's own OI share when
      // pulling to a wall, else the prep layer's max-pain strength.
      const strengthPct =
        wallOi != null ? (w.totalOi > 0 ? wallOi / w.totalOi : p.magnetStrengthPct) : p.magnetStrengthPct;
      // Mean-reversion toward the magnet whose strength RAMPS UP into the close (kappa → ~0.6 near
      // expiry) — the pin gets stickier as gamma concentrates. Paired with diffusion that shrinks with
      // remaining time, this is a Brownian-bridge-style pin: paths bulge mid-session, then the
      // strengthening pull + collapsing noise re-converge them onto the pin → the cone pinches.
      // Strength-scaled so thin far walls don't glue every path 100pts away from spot.
      const kappa = clamp(pullFraction(tFracAt, reg, p.degraded, strengthPct) * (0.12 + 0.88 * (1 - tFracAt)), 0, 0.6);
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
  const conf = calibrateConfidence(inBand / paths, input.spot, band, sigmaFull);
  const cone: PinConeStep[] = stepPrices.map((arr, i) => {
    const a = [...arr].sort((x, y) => x - y);
    const q = (f: number) => a[clamp(Math.floor(f * (a.length - 1)), 0, a.length - 1)]!;
    return { tMin: Number((p.tMin - dtMin * i).toFixed(1)), p10: Number(q(0.1).toFixed(2)), p50: Number(q(0.5).toFixed(2)), p90: Number(q(0.9).toFixed(2)) };
  });
  const scenarios: PinScenario[] = ranked.slice(0, 4).map(([close, n], i) => ({ close, p: Number((n / paths).toFixed(2)), kind: i === 0 ? p.magnetKind : "path" }));
  return assemble(input, p, "montecarlo", pin, conf, band, cone, scenarios, cone[cone.length - 1]?.p50 ?? pin, headlineClamped);
}

function assemble(
  input: PinForecastInput, p: Prep, method: "analytic" | "montecarlo",
  pin: number, conf: number, band: [number, number], cone: PinConeStep[], scenarios: PinScenario[], medianClose: number,
  magnetClamped = false
): PinForecast {
  return {
    available: true, method,
    spot: input.spot, priorClose: input.priorClose, timeToCloseMin: Number(p.tMin.toFixed(1)),
    pin: Number(pin.toFixed(2)), projectedClose: Number(medianClose.toFixed(2)), pinPct: Number(conf.toFixed(3)),
    pinBand: band,
    pinPctOfClose: input.priorClose && input.priorClose > 0 ? Number((((pin - input.priorClose) / input.priorClose) * 100).toFixed(2)) : null,
    regime: p.regime, flip: p.flip,
    magnet: p.magnetStrike == null ? null : { strike: p.magnetStrike, kind: p.magnetKind, direction: p.direction, strengthPct: Number(p.magnetStrengthPct.toFixed(3)) },
    charmState: p.charmState,
    cone, scenarios,
    degraded: p.degraded, degradeReason: p.degradeReason,
    ivFallback: p.ivFallback,
    magnetClamped,
    drivers: buildDrivers(p, input, medianClose),
  };
}

const EMPTY = (input: PinForecastInput, reason: string, ivFallback = false): PinForecast => ({
  available: false, method: input.method ?? "analytic", spot: input.spot, priorClose: input.priorClose,
  timeToCloseMin: Math.max(0, (input.closeMs - input.nowMs) / 60000), pin: null, projectedClose: null, pinPct: null, pinBand: null,
  pinPctOfClose: null, regime: "unknown", flip: null, magnet: null, charmState: "early", cone: [], scenarios: [],
  degraded: false, degradeReason: null, ivFallback, magnetClamped: false,
  drivers: [{ label: reason === "closed" ? "Market closed" : "Collecting", detail: reason === "closed" ? "The 0DTE pin forecast runs during RTH." : "Waiting for a live 0DTE chain and session bars.", weight: 1 }],
});

/** Forecast the 0DTE close. Dispatches analytic (default) or montecarlo; never throws. */
export function forecastPin(input: PinForecastInput): PinForecast {
  if (!(input.spot > 0)) return EMPTY(input, "collecting");
  if (input.closeMs <= input.nowMs) return EMPTY(input, "closed");
  const p = prepare(input);
  // A thin chain can't build a ladder → unavailable. That's also the ONLY path where the hardcoded
  // 12% IV guess is the sole vol input (an available forecast always reads a real chain IV for the
  // cone), so surface prepare()'s ivFallback here too: it distinguishes "no forecast, and the only
  // IV we had was the guess" from "no forecast, but a real IV was supplied".
  if (!p.ok) return EMPTY(input, "collecting", p.ivFallback);
  return (input.method ?? "analytic") === "montecarlo" ? montecarlo(input, p) : analytic(input, p);
}
