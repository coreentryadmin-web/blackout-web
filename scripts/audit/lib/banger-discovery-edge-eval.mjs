/**
 * Pure evaluation helpers for the Engine B (Banger) discovery-edge study (Ask Largo standing
 * mandate, 2026-09-25, operator directive: "report the relationship between discovery gain,
 * volume, close strength, price, and any other already-captured pre-entry variables versus MAE,
 * MFE, final return, 100%+ hit rate, and loss rate... avoid look-ahead bias and do not optimize
 * against information unavailable when the trade was opened").
 *
 * LOOK-AHEAD DISCIPLINE (the whole point of keeping this in a separate, reviewable module):
 * `derivePreEntryMetrics` reads ONLY fields that existed at commit time (the discovery screen's own
 * output — gain/vol/dollar-vol/close-strength/price — plus contract geometry chosen at commit
 * (strike, expiry) and the session calendar date). `deriveOutcomeMetrics` reads ONLY fields that are
 * necessarily observed AFTER entry (peak/trough premium, realized P&L, close reason). Neither
 * function ever reads the other's inputs, and nothing here computes a predictor from an outcome
 * field — that is the one invariant this module exists to keep from drifting.
 *
 * BUCKETING/VERDICT — deliberately copied in spirit from swing-score-calibration-eval.mjs's
 * chooseBucketCount/scoreCalibrationVerdict: quantile buckets (not fixed ranges, so a skewed
 * variable doesn't starve some buckets), a verdict that requires BOTH a real spread and a monotonic
 * (Spearman) trend before calling it a ranking (a spread alone is not evidence — that tool's own
 * history: a scrambled spread was once mislabeled a real separation), and thin buckets are always
 * named, never silently dropped or silently trusted.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

/** Same shrink-to-fit bucket-count rule as swing-score-calibration-eval.mjs — never split a small
 *  population into buckets so thin they're indistinguishable from noise. */
export function chooseBucketCount(n, { maxBuckets = 5, minPerBucket = 5 } = {}) {
  if (n < minPerBucket * 2) return 1;
  return Math.max(1, Math.min(maxBuckets, Math.floor(n / minPerBucket)));
}

function finite(x) {
  return typeof x === "number" && Number.isFinite(x);
}

/**
 * Pre-entry variables only — everything here is knowable at the moment the position is committed.
 * @param {object} row - a BangerPositionRow-shaped object (from GET /api/admin/banger/closed-export)
 */
export function derivePreEntryMetrics(row) {
  const discovery = row?.entry_context?.discovery ?? null;
  const priceAtDiscovery = finite(discovery?.close) ? discovery.close : null;
  const strike = finite(row?.contract_strike) ? row.contract_strike : null;
  const otmPct = priceAtDiscovery != null && priceAtDiscovery > 0 && strike != null
    ? (strike / priceAtDiscovery - 1) * 100
    : null;

  const sessionDate = typeof row?.session_date === "string" ? row.session_date : null;
  const expiry = typeof row?.contract_expiry === "string" ? row.contract_expiry : null;
  let dteAtEntry = null;
  if (sessionDate && expiry) {
    const entryMs = Date.parse(`${sessionDate}T00:00:00Z`);
    const expiryMs = Date.parse(`${expiry}T00:00:00Z`);
    if (Number.isFinite(entryMs) && Number.isFinite(expiryMs)) {
      dteAtEntry = Math.round((expiryMs - entryMs) / 86_400_000);
    }
  }

  let dayOfWeek = null;
  if (sessionDate) {
    const d = new Date(`${sessionDate}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) dayOfWeek = d.getUTCDay(); // 0=Sun..6=Sat
  }

  return {
    discoveryGainPct: finite(row?.discovery_gain) ? row.discovery_gain * 100 : null,
    discoveryVol: finite(row?.discovery_vol) ? row.discovery_vol : null,
    discoveryDollarVol: finite(row?.discovery_dollar_vol) ? row.discovery_dollar_vol : null,
    discoveryCloseStrength: finite(row?.discovery_close_strength) ? row.discovery_close_strength : null,
    priceAtDiscovery,
    otmPct,
    dteAtEntry,
    dayOfWeek,
    entryPremium: finite(row?.entry_premium) ? row.entry_premium : null,
  };
}

/**
 * Outcome variables only — everything here is necessarily observed strictly after entry.
 * MFE/MAE are expressed relative to entry premium (matches this repo's own mfe-capture.ts
 * convention — a relative retracement, not a raw percentage-point delta), because the operator's
 * question is "what separated the runners from the losers", which is about the SHAPE of the trade,
 * not the option's absolute price.
 */
export function deriveOutcomeMetrics(row) {
  const entryPremium = finite(row?.entry_premium) ? row.entry_premium : null;
  const peak = finite(row?.peak_premium) ? row.peak_premium : null;
  const trough = finite(row?.trough_premium) ? row.trough_premium : null;
  const realizedPnlPct = finite(row?.realized_pnl_pct) ? row.realized_pnl_pct : null;

  const mfePct = entryPremium != null && entryPremium > 0 && peak != null
    ? (peak / entryPremium - 1) * 100
    : null;
  // Trough is a running MINIMUM since entry — it can sit above entry (never went red) or below.
  const maePct = entryPremium != null && entryPremium > 0 && trough != null
    ? (trough / entryPremium - 1) * 100
    : null;

  return {
    mfePct,
    maePct,
    realizedPnlPct,
    is100PlusMfe: mfePct != null ? mfePct >= 100 : null,
    is100PlusRealized: realizedPnlPct != null ? realizedPnlPct >= 100 : null,
    isLoss: realizedPnlPct != null ? realizedPnlPct < 0 : null,
    status: typeof row?.status === "string" ? row.status : null,
  };
}

/** One row's pre-entry + outcome metrics, joined — the unit the rest of this module operates on. */
export function deriveRowMetrics(row) {
  return { ...derivePreEntryMetrics(row), ...deriveOutcomeMetrics(row), id: row?.id ?? null, ticker: row?.ticker ?? null };
}

/**
 * Quantile-bucket a joined-metrics population by ONE pre-entry variable, reporting per-bucket
 * outcome stats. A row missing either the bucketing variable or the outcome variable is excluded
 * from THIS bucketing (never coerced to a bucket, never silently zeroed).
 * @param {ReturnType<typeof deriveRowMetrics>[]} rows
 * @param {string} variableKey - a derivePreEntryMetrics key, e.g. "discoveryGainPct"
 * @param {string} outcomeKey - a deriveOutcomeMetrics key to average, e.g. "realizedPnlPct"
 */
export function bucketByVariableQuantile(rows, variableKey, outcomeKey, opts = {}) {
  const usable = rows.filter(
    (r) => finite(r[variableKey]) && finite(r[outcomeKey]),
  );
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
    const wins = rowsInBucket.filter((r) => r.isLoss === false).length;
    const hits100Mfe = rowsInBucket.filter((r) => r.is100PlusMfe === true).length;
    const hits100Realized = rowsInBucket.filter((r) => r.is100PlusRealized === true).length;
    const avg = (key) => {
      const vals = rowsInBucket.map((r) => r[key]).filter(finite);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    return {
      bucketIndex: i,
      variableKey,
      label: n ? `${round2(lo)}..${round2(hi)}` : `bucket ${i}`,
      n,
      winRate: n ? (wins / n) * 100 : null,
      hit100MfeRate: n ? (hits100Mfe / n) * 100 : null,
      hit100RealizedRate: n ? (hits100Realized / n) * 100 : null,
      avgRealizedPnlPct: avg("realizedPnlPct"),
      avgMfePct: avg("mfePct"),
      avgMaePct: avg("maePct"),
    };
  });
}

function round2(x) {
  return x == null ? null : Math.round(x * 100) / 100;
}

/** Spearman rank correlation between a bucket sequence's own rank (0..n-1, already quantile-ordered
 *  by the bucketing variable) and a chosen outcome field's value — reused for the verdict below and
 *  exposed standalone for a direct pairwise report. */
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

/**
 * Same RANKS/SPREAD-WITHOUT-ORDER/INVERTED/FLAT/INSUFFICIENT-DATA shape as
 * swing-score-calibration-eval.mjs's scoreCalibrationVerdict, generalized to any bucketed metric
 * (winRate, hit100RealizedRate, avgRealizedPnlPct, ...) rather than just winRate. A spread alone is
 * never enough to call it a ranking — requires a monotonic trend too.
 */
export function bucketedMetricVerdict(bucketSummary, metricKey, { minN = 5, spreadThreshold = 5, rhoThreshold = 0.6 } = {}) {
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

/** Direct (unbucketed) Spearman correlation between one pre-entry variable and one outcome
 *  variable across the whole usable population — a complementary view to the bucketed verdict,
 *  since bucketing can mask or manufacture structure at small n. */
export function pairwiseSpearman(rows, variableKey, outcomeKey) {
  const usable = rows.filter((r) => finite(r[variableKey]) && finite(r[outcomeKey]));
  if (usable.length < 4) return { n: usable.length, rho: null, note: "n<4, not computed" };
  const sortedByVar = [...usable].sort((a, b) => a[variableKey] - b[variableKey]);
  const outcomeInVarOrder = sortedByVar.map((r) => r[outcomeKey]);
  return { n: usable.length, rho: Math.round(spearmanOfSequence(outcomeInVarOrder) * 1000) / 1000 };
}

/** Population-level baseline (no segmentation) — always report this FIRST, before any bucketed
 *  claim, so a bucket's "edge" is legible against the unconditional rate. */
export function baselineSummary(rows) {
  const usable = rows.filter((r) => r.realizedPnlPct != null);
  const n = usable.length;
  const wins = usable.filter((r) => r.isLoss === false).length;
  const hits100Mfe = usable.filter((r) => r.is100PlusMfe === true).length;
  const hits100Realized = usable.filter((r) => r.is100PlusRealized === true).length;
  const avg = (key) => {
    const vals = usable.map((r) => r[key]).filter(finite);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return {
    n,
    winRate: n ? round2((wins / n) * 100) : null,
    hit100MfeRate: n ? round2((hits100Mfe / n) * 100) : null,
    hit100RealizedRate: n ? round2((hits100Realized / n) * 100) : null,
    avgRealizedPnlPct: round2(avg("realizedPnlPct")),
    avgMfePct: round2(avg("mfePct")),
    avgMaePct: round2(avg("maePct")),
  };
}
