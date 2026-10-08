/**
 * HELIX SWEEP forward-return backtest — pure evaluation helpers.
 * ================================================================
 *
 * WHY THIS EXISTS (operator directive, 2026-09-26): before touching any production discovery
 * logic, measure whether a HUGE single-day options SWEEP (aggressive, urgency-driven, `has_sweep`)
 * carries real forward directional edge — separately from a BLOCK print (negotiated/floor,
 * `has_floor`) and separately from the EXISTING persistence-gated FLOW accumulation engine
 * (`flow-accumulation.ts`) that swing/0DTE already run. This module holds the pure classification,
 * forward-return, and verdict math; the live orchestration (real UW + Polygon fetches) lives in
 * `scripts/audit/helix-sweep-forward-return-backtest.mjs`.
 *
 * TERMINOLOGY MAPPING (disclosed, not fabricated): UW's flow-alerts payload has no literal
 * "is_block" field. The closest real signal is `has_floor` (a floor-negotiated/crossed print) —
 * used here as the BLOCK proxy throughout. This is stated once, here, rather than silently implied.
 *
 * LOOK-AHEAD DISCIPLINE (mirrors banger-discovery-edge-eval.mjs's own invariant): every function
 * below that computes a PRE-signal classification (`classifyPrint`, `moneynessBucket`,
 * `premiumBucket`, `trendAlignment`, `repeatedClassification`) reads ONLY fields that existed at
 * or before alert time. Every function that computes a POST-signal outcome (`forwardReturn`,
 * `optionReturnProxy`) reads ONLY bars/time strictly after the alert. Neither reads the other's
 * output — a classification is never derived from an outcome field.
 *
 * PURE AND TOTAL: no IO, no clock (nowMs is always passed in), no throw — honest null/undefined on
 * anything unmeasurable, never a fabricated number.
 *
 * DATA-AVAILABILITY FINDING (measured 2026-09-26, before writing the live backtest): UW's
 * flow-alerts feed only carries live-computed greeks (`delta`/`theta`/`gamma`/`vega`/`rho`/`iv`) for
 * roughly the trailing 3 CALENDAR days — a paginated fetch for anything older returns `delta: null`
 * on 100% of rows (measured: 50/50 populated at 3.0d back, 0/50 at 3.3d back), while `strike` /
 * `underlying_price` / `price` (the raw option price) remain populated indefinitely. Since this
 * backtest needs alerts old enough to have a COMPLETED 10-trading-day forward window, `delta` is
 * essentially never available for the population actually studied. Consequence: `deltaAbs`
 * (moneyness) and the delta-dependent `optionReturnProxy` are near-universally null on this study's
 * real population — NOT a bug, a genuine upstream data-availability boundary, disclosed here and in
 * the live script's own report rather than silently producing empty buckets. `classifyPrint` below
 * therefore ALSO derives a delta-free moneyness read (`otmPct`, `otmPctAbs`) from `strike` vs
 * `underlyingPriceAtAlert` — available on every row regardless of alert age — and the live script
 * uses THAT for the moneyness segmentation dimension instead of `deltaAbs`.
 */

function finite(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function numOrNull(v) {
  if (v == null) return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * One raw UW flow-alert print, reduced to exactly the pre-signal fields this study needs.
 * `raw` is the UW flow-alerts raw payload (see fetchMarketFlowAlertRows); `flow` is the already
 * parsed MarketFlowAlert (parseUwFlowAlert) riding alongside it.
 */
export function classifyPrint(flow, raw) {
  if (!flow || !raw) return null;
  const ticker = String(flow.ticker ?? "").toUpperCase();
  const side = flow.option_type === "CALL" ? "call" : flow.option_type === "PUT" ? "put" : null;
  if (!ticker || !side || !flow.expiry || !(flow.strike > 0)) return null;

  const alertedAtMs = Date.parse(flow.alerted_at ?? raw.created_at ?? "");
  if (!Number.isFinite(alertedAtMs)) return null;

  const premium = finite(flow.premium) ? flow.premium : numOrNull(raw.total_premium);
  const isSweep = Boolean(raw.has_sweep ?? flow.has_sweep);
  // BLOCK PROXY — see header disclosure: UW sends no literal "is_block"; `has_floor` (a
  // floor-negotiated/crossed print) is the closest real analog and is used as-is, never renamed
  // to imply UW itself calls it "block".
  const isFloor = Boolean(raw.has_floor);

  const delta = numOrNull(raw.delta);
  const theta = numOrNull(raw.theta);
  const underlyingPriceAtAlert = numOrNull(raw.underlying_price);
  const entryOptionPrice = numOrNull(raw.price);
  const volume = numOrNull(raw.volume);
  const openInterest = numOrNull(raw.open_interest);
  const volumeOiRatio = numOrNull(raw.volume_oi_ratio) ?? (
    finite(volume) && finite(openInterest) && openInterest > 0 ? volume / openInterest : null
  );
  const tradeCount = numOrNull(raw.trade_count ?? flow.trade_count);

  const dte = flow.expiry
    ? Math.round((Date.parse(`${flow.expiry}T00:00:00Z`) - alertedAtMs) / 86_400_000)
    : null;

  // Delta-free moneyness (see header finding — delta itself is unavailable this far back in the
  // feed). Positive = OTM, negative = ITM, 0 = ATM; sign convention is side-aware (a call above spot
  // is OTM, a put below spot is OTM). otmPctAbs is the magnitude used for bucketing "how far from
  // the money", independent of ITM/OTM direction.
  const spot = underlyingPriceAtAlert;
  const otmPct = finite(spot) && spot > 0 && finite(flow.strike)
    ? (side === "call" ? (flow.strike - spot) / spot : (spot - flow.strike) / spot) * 100
    : null;
  const otmPctAbs = otmPct != null ? Math.abs(otmPct) : null;

  // Naive side direction (call=bullish, put=bearish) — the plain, most legible reading, kept
  // ALONGSIDE (not replacing) an aggressor-weighted read so both are measurable.
  const sideDirection = side === "call" ? "bull" : "bear";
  // Aggressor-weighted direction: ask-side calls / bid-side puts = bull (mirrors
  // flow-accumulation.ts's own directionalPremium convention exactly, so the two engines'
  // notion of "bullish" cannot silently drift apart).
  const askPrem = numOrNull(raw.total_ask_side_prem);
  const bidPrem = numOrNull(raw.total_bid_side_prem);
  let aggressorDirection = null;
  if (askPrem != null || bidPrem != null) {
    const a = askPrem ?? 0, b = bidPrem ?? 0;
    if (a + b > 0) {
      const bullShare = side === "call" ? a / (a + b) : b / (a + b);
      aggressorDirection = bullShare >= 0.5 ? "bull" : "bear";
    }
  }

  return {
    ticker,
    side,
    strike: flow.strike,
    expiry: flow.expiry,
    alertedAtMs,
    premium,
    isSweep,
    isFloor,
    delta,
    deltaAbs: delta != null ? Math.abs(delta) : null,
    theta,
    otmPct,
    otmPctAbs,
    underlyingPriceAtAlert,
    entryOptionPrice,
    volume,
    openInterest,
    volumeOiRatio,
    tradeCount,
    dte,
    sideDirection,
    aggressorDirection,
    alertRule: typeof flow.alert_rule === "string" ? flow.alert_rule : null,
  };
}

/** Identity key for grouping repeated hits on the same position (matches flow-accumulation.ts's
 *  own `keyOf` convention exactly, so "repeated" here means the same thing it means there). */
export function identityKey(p) {
  return `${p.ticker}|${p.expiry}|${p.strike}|${p.side}`;
}

/** "Huge" qualifying floor — $1M premium is this codebase's OWN pre-existing "whale" threshold
 *  (parseUwFlowAlert's `route` field), reused here rather than inventing a new number. */
export const HUGE_PREMIUM_FLOOR = 1_000_000;

export function isHugeSweep(p, floor = HUGE_PREMIUM_FLOOR) {
  return Boolean(p?.isSweep) && finite(p?.premium) && p.premium >= floor;
}

export function isHugeBlock(p, floor = HUGE_PREMIUM_FLOOR) {
  return Boolean(p?.isFloor) && !p?.isSweep && finite(p?.premium) && p.premium >= floor;
}

/** Repeated (2+ qualifying huge prints on the SAME identity within the fetched window) vs
 *  one-off (exactly 1). Pass the pre-computed count for the identity — pure, no lookup here. */
export function repeatedClassification(countForIdentity) {
  if (!finite(countForIdentity) || countForIdentity < 1) return null;
  return countForIdentity >= 2 ? "repeated" : "one-off";
}

/**
 * Underlying trend alignment at alert time — REAL closes strictly BEFORE (or at) the alert's own
 * ET day, never a look-ahead. `closesBeforeAlert` must already be sliced to end at-or-before the
 * alert's bar; this function does not know "now" and cannot enforce that itself, so the caller owns
 * the slice (see the live script's own comment on this at the call site).
 */
export function trendAlignment(closesBeforeAlert, direction) {
  if (!Array.isArray(closesBeforeAlert) || closesBeforeAlert.length < 20 || !direction) return null;
  const last = closesBeforeAlert[closesBeforeAlert.length - 1];
  const window = closesBeforeAlert.slice(-20);
  const sma20 = window.reduce((a, b) => a + b, 0) / window.length;
  if (!(last > 0) || !(sma20 > 0)) return null;
  const aboveSma = last > sma20;
  const uptrend = aboveSma ? "up" : "down";
  const aligned = (direction === "bull" && uptrend === "up") || (direction === "bear" && uptrend === "down");
  return { uptrend, aligned: aligned ? "aligned" : "counter-trend" };
}

/**
 * Forward UNDERLYING return, sign-aligned to `direction` ("bull"/"bear"), at exactly `horizonDays`
 * REAL trading days after the alert's own bar. `dailyBars` must be sorted ascending by `t` and
 * already real Polygon daily aggs (so "N trading days later" is just index+N — weekends/holidays
 * are never bars, so they are never counted). `alertBarIndex` is the index of the bar covering (or
 * immediately preceding) the alert's own ET day — resolved by the caller, since it requires
 * timezone-aware day matching this pure function should not own.
 */
export function forwardUnderlyingReturn(dailyBars, alertBarIndex, horizonDays, direction) {
  if (!Array.isArray(dailyBars) || !finite(alertBarIndex) || alertBarIndex < 0) return null;
  const entryBar = dailyBars[alertBarIndex];
  const targetBar = dailyBars[alertBarIndex + horizonDays];
  if (!entryBar || !targetBar || !(entryBar.c > 0) || !finite(targetBar.c)) return null;
  const rawReturnPct = ((targetBar.c - entryBar.c) / entryBar.c) * 100;
  const sign = direction === "bear" ? -1 : 1;
  return Math.round(rawReturnPct * sign * 100) / 100;
}

/**
 * Option-performance PROXY — first-order delta+theta estimate, NOT a real observed option price.
 * Disclosed explicitly (never presented as a real fill): estimatedPrice = entryPrice +
 * delta*(spotMove) + theta*(tradingDaysElapsed), floored at 0 (an option cannot price negative).
 * Ignores gamma/vega/IV-crush — a real second-order effect this proxy cannot see, named here so a
 * caller never over-reads precision into it, especially at the 10-day horizon where the linear
 * delta approximation is weakest.
 */
export function optionReturnProxy(p, dailyBars, alertBarIndex, horizonDays) {
  if (!p || !finite(p.entryOptionPrice) || p.entryOptionPrice <= 0) return null;
  if (!finite(p.delta)) return null;
  const entryBar = dailyBars?.[alertBarIndex];
  const targetBar = dailyBars?.[alertBarIndex + horizonDays];
  if (!entryBar || !targetBar || !(entryBar.c > 0) || !finite(targetBar.c)) return null;
  const spotMove = targetBar.c - entryBar.c;
  const thetaTerm = finite(p.theta) ? p.theta * horizonDays : 0;
  const estimated = Math.max(0, p.entryOptionPrice + p.delta * spotMove + thetaTerm);
  return Math.round(((estimated - p.entryOptionPrice) / p.entryOptionPrice) * 10000) / 100;
}

/** Quantile bucket count — shrinks to fit a small population rather than manufacturing thin,
 *  noise-indistinguishable buckets (same rule as swing-score-calibration-eval.mjs /
 *  banger-discovery-edge-eval.mjs's own chooseBucketCount). */
export function chooseBucketCount(n, { maxBuckets = 5, minPerBucket = 5 } = {}) {
  if (n < minPerBucket * 2) return 1;
  return Math.max(1, Math.min(maxBuckets, Math.floor(n / minPerBucket)));
}

function round2(x) {
  return x == null ? null : Math.round(x * 100) / 100;
}

function spearmanOfSequence(values) {
  const n = values.length;
  if (n < 2) return 0;
  const ranks = values.map((_, i) => i);
  const sortedVals = [...values].sort((a, b) => a - b);
  const valRanks = values.map((v) => {
    const first = sortedVals.indexOf(v);
    const last = sortedVals.lastIndexOf(v);
    return (first + last) / 2;
  });
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const mr = mean(ranks), mv = mean(valRanks);
  let num = 0, dr = 0, dv = 0;
  for (let i = 0; i < n; i++) {
    num += (ranks[i] - mr) * (valRanks[i] - mv);
    dr += (ranks[i] - mr) ** 2;
    dv += (valRanks[i] - mv) ** 2;
  }
  return dr > 0 && dv > 0 ? num / Math.sqrt(dr * dv) : 0;
}

/** Bucket a population by one numeric pre-signal variable, reporting per-bucket outcome stats for
 *  one outcome key (e.g. a specific horizon's `fwdRet_5d`). Mirrors
 *  banger-discovery-edge-eval.mjs's bucketByVariableQuantile, generalized to an arbitrary
 *  outcome-key set (win-rate style stats are computed by the caller from `rows`, not baked in here,
 *  since this study's "win" definition varies by context: sign-aligned-positive for direction
 *  studies, threshold-hit for magnitude studies). */
export function bucketByVariableQuantile(rows, variableKey, outcomeKey, opts = {}) {
  const usable = rows.filter((r) => finite(r[variableKey]) && finite(r[outcomeKey]));
  const bucketCount = chooseBucketCount(usable.length, opts);
  const sorted = [...usable].sort((a, b) => a[variableKey] - b[variableKey]);
  const buckets = Array.from({ length: bucketCount }, () => []);
  sorted.forEach((row, i) => {
    const idx = Math.min(bucketCount - 1, Math.floor((i / sorted.length) * bucketCount));
    buckets[idx].push(row);
  });
  return buckets.map((rowsInBucket, i) => {
    const n = rowsInBucket.length;
    const lo = n ? Math.min(...rowsInBucket.map((r) => r[variableKey])) : null;
    const hi = n ? Math.max(...rowsInBucket.map((r) => r[variableKey])) : null;
    const vals = rowsInBucket.map((r) => r[outcomeKey]).filter(finite);
    const wins = vals.filter((v) => v > 0).length;
    return {
      bucketIndex: i,
      variableKey,
      label: n ? `${round2(lo)}..${round2(hi)}` : `bucket ${i}`,
      n,
      winRate: vals.length ? round2((wins / vals.length) * 100) : null,
      avgOutcome: vals.length ? round2(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
    };
  });
}

/** Same RANKS/SPREAD-WITHOUT-ORDER/INVERTED/FLAT/INSUFFICIENT-DATA shape used across this whole
 *  toolkit (helix-score-eval.mjs / swing-score-calibration-eval.mjs / banger-discovery-edge-eval.mjs)
 *  — a spread alone is never a ranking; both a real spread AND a monotonic (Spearman) trend are
 *  required. */
export function bucketedMetricVerdict(bucketSummary, metricKey, { minN = 5, spreadThreshold = 3, rhoThreshold = 0.6 } = {}) {
  const usable = bucketSummary.filter((b) => b.n >= minN && finite(b[metricKey]));
  const excluded = bucketSummary.filter((b) => b.n < minN).map((b) => `${b.label}(n=${b.n})`);
  if (usable.length < 2) {
    return { verdict: "INSUFFICIENT DATA", metricKey, usableBuckets: usable.length, excluded };
  }
  const values = usable.map((b) => b[metricKey]);
  const spread = Math.max(...values) - Math.min(...values);
  const rho = spearmanOfSequence(values);
  const verdict =
    spread < spreadThreshold ? "FLAT"
      : rho >= rhoThreshold ? "RANKS"
        : rho <= -rhoThreshold ? "INVERTED"
          : "SPREAD WITHOUT ORDER";
  return {
    verdict,
    metricKey,
    spread: round2(spread),
    rho: Math.round(rho * 1000) / 1000,
    best: usable.reduce((a, b) => (b[metricKey] > a[metricKey] ? b : a)),
    worst: usable.reduce((a, b) => (b[metricKey] < a[metricKey] ? b : a)),
    usableBuckets: usable.length,
    excluded,
  };
}

/** Population-level baseline (no segmentation) for one outcome key — always report this FIRST,
 *  so any bucketed "edge" is legible against the unconditional rate. */
export function baselineSummary(rows, outcomeKey) {
  const vals = rows.map((r) => r[outcomeKey]).filter(finite);
  const n = vals.length;
  const wins = vals.filter((v) => v > 0).length;
  return {
    n,
    winRate: n ? round2((wins / n) * 100) : null,
    avgOutcome: n ? round2(vals.reduce((a, b) => a + b, 0) / n) : null,
  };
}
