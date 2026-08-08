// Pure regression-detection logic for seo-cwv-monitor.mjs, split out for unit testing without
// hitting the live PageSpeed Insights API.

export const CATEGORY_TOLERANCE = 0.03; // a 3-point (0.03) score drop counts as a regression
export const METRIC_TOLERANCE_PCT = 0.15; // a 15% increase in a timing metric counts as a regression

export function extractMetrics(psi) {
  const categories = psi.lighthouseResult?.categories ?? {};
  const audits = psi.lighthouseResult?.audits ?? {};
  return {
    scores: {
      performance: categories.performance?.score ?? null,
      accessibility: categories.accessibility?.score ?? null,
      "best-practices": categories["best-practices"]?.score ?? null,
      seo: categories.seo?.score ?? null,
    },
    metrics: {
      lcpMs: audits["largest-contentful-paint"]?.numericValue ?? null,
      clsScore: audits["cumulative-layout-shift"]?.numericValue ?? null,
      tbtMs: audits["total-blocking-time"]?.numericValue ?? null,
      fcpMs: audits["first-contentful-paint"]?.numericValue ?? null,
      speedIndexMs: audits["speed-index"]?.numericValue ?? null,
    },
  };
}

export function compare(baselinePage, current) {
  const regressions = [];
  if (!baselinePage) return regressions;
  for (const [cat, score] of Object.entries(current.scores)) {
    const base = baselinePage.scores?.[cat];
    if (base == null || score == null) continue;
    if (score < base - CATEGORY_TOLERANCE) {
      regressions.push(`${cat} score dropped ${base.toFixed(2)} -> ${score.toFixed(2)} (tolerance ${CATEGORY_TOLERANCE})`);
    }
  }
  for (const [metric, val] of Object.entries(current.metrics)) {
    const base = baselinePage.metrics?.[metric];
    if (base == null || val == null || base === 0) continue;
    const pctChange = (val - base) / base;
    if (pctChange > METRIC_TOLERANCE_PCT) {
      regressions.push(
        `${metric} regressed ${base.toFixed(0)} -> ${val.toFixed(0)} (+${(pctChange * 100).toFixed(0)}%, tolerance ${METRIC_TOLERANCE_PCT * 100}%)`,
      );
    }
  }
  return regressions;
}
