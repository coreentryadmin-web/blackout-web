// Pure classification helpers for turning a GSC Search Analytics pull into a prioritized
// opportunity register. No network, no secrets — unit-tested by gsc-opportunities.test.ts.
// The live pull lives in scripts/audit/gsc-opportunities-report.mjs.

/** A query is brand/navigational (not organic content demand) if it names the brand or is a
 *  site: audit. These MUST be excluded from opportunity ranking: they already "rank" and inflate
 *  every page's numbers, which is how a legal page reads as a page-1 winner. */
export function isBrandQuery(q, { brand = /black\s?out/i, domain = "blackouttrades.com" } = {}) {
  return brand.test(q) || q.includes(`site:${domain}`);
}

/** Search-position band. The bands are where the LEVER differs, not arbitrary cuts:
 *  - page1 (<=10): won the ranking; the lever is CTR (title/meta), not position.
 *  - striking (10-20): page 2 — a real, close push to page 1 is possible on-page.
 *  - deep (20-50) / far (>50): authority/time-limited; on-page edits rarely move these. */
export function positionBand(pos) {
  if (pos <= 10.5) return "page1";
  if (pos <= 20.5) return "striking";
  if (pos <= 50.5) return "deep";
  return "far";
}

/**
 * Rank NON-BRAND query rows into opportunity buckets.
 * - strikingDistance: page-2 queries (pos 10.5-20.5) with real impressions — the only band where
 *   an on-page change has a defensible shot at page 1. This is where to spend on-page effort.
 * - ctrGap: already on page 1 (pos <= 10.5) but earning no clicks despite impressions — a
 *   title/meta CTR problem, NOT a ranking problem.
 * - deepDemand: high-impression queries stuck page 3+ — proven demand that is authority-limited;
 *   surfaced so it is not mistaken for "no demand", but flagged as out-of-on-page-reach.
 */
export function classifyQueryOpportunities(rows, { minImpressions = 3 } = {}) {
  const organic = rows.filter((r) => !isBrandQuery(r.keys[1] ?? r.keys[0]));
  const strikingDistance = [];
  const ctrGap = [];
  const deepDemand = [];
  for (const r of organic) {
    if (r.impressions < minImpressions) continue;
    const band = positionBand(r.position);
    if (band === "striking") strikingDistance.push(r);
    else if (band === "page1" && r.clicks === 0) ctrGap.push(r);
    else if ((band === "deep" || band === "far") && r.impressions >= minImpressions * 2) deepDemand.push(r);
  }
  const byImp = (a, b) => b.impressions - a.impressions;
  return {
    strikingDistance: strikingDistance.sort(byImp),
    ctrGap: ctrGap.sort(byImp),
    deepDemand: deepDemand.sort(byImp),
  };
}

/** Pages that host real striking-distance demand — where on-page work is worth doing. */
export function pageOpportunities(pageRows, { minImpressions = 5 } = {}) {
  return pageRows
    .filter((r) => r.impressions >= minImpressions && positionBand(r.position) === "striking")
    .sort((a, b) => b.impressions - a.impressions);
}
