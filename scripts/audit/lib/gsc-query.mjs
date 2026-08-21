// Pure helpers for the GSC Search Analytics pull. No network, no secrets — unit-tested by
// gsc-query.test.ts. The live pull (scripts/audit/gsc-search-analytics.mjs) composes these
// with the Secrets Manager read + JWT signing + fetch.

/**
 * URL-encode a GSC property id. For a DOMAIN property the id is `sc-domain:example.com`
 * and it MUST be encoded as `sc-domain%3Aexample.com`. Getting this wrong does NOT error —
 * the API returns an empty result set, which reads as "no search data" and is the exact
 * absence-as-fact trap the fleet keeps paying for. So this is a named function with a test.
 */
export function encodeSiteProperty(property) {
  return encodeURIComponent(property);
}

/** RFC3339 date (YYYY-MM-DD, UTC) N days before a base epoch-ms. */
export function isoDate(epochMs, minusDays = 0) {
  const d = new Date(epochMs);
  d.setUTCDate(d.getUTCDate() - minusDays);
  return d.toISOString().slice(0, 10);
}

/**
 * GSC finalizes data on a ~2-3 day lag, so a window ending "today" is partial and reads low.
 * End 3 days back, span `days` before that. Returns {startDate,endDate}.
 */
export function reportRange(epochMs, days = 28, lagDays = 3) {
  const endMs = epochMs - lagDays * 86400_000;
  return { startDate: isoDate(endMs, days - 1), endDate: isoDate(endMs, 0) };
}

/** JWT claim set for the service-account → OAuth token exchange (webmasters.readonly, 1h). */
export function jwtClaim(clientEmail, tokenUri, nowSec) {
  return {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: tokenUri,
    iat: nowSec,
    exp: nowSec + 3600,
  };
}

/**
 * Branded vs non-branded split of query rows. A query is branded if it mentions the brand
 * OR is a site: operator search of the brand domain (someone auditing what's indexed — not
 * organic discovery, and it inflates "branded" impressions if miscounted as content demand).
 */
export function brandedSplit(rows, { brand = /black\s?out/i, domain = "blackouttrades.com" } = {}) {
  const isBranded = (k) => brand.test(k) || k.includes(`site:${domain}`);
  const branded = rows.filter((r) => isBranded(r.keys[0]));
  const nonBranded = rows.filter((r) => !isBranded(r.keys[0]));
  const sum = (a, key) => a.reduce((s, r) => s + (r[key] ?? 0), 0);
  return {
    branded: { queries: branded.length, clicks: sum(branded, "clicks"), impressions: sum(branded, "impressions") },
    nonBranded: { queries: nonBranded.length, clicks: sum(nonBranded, "clicks"), impressions: sum(nonBranded, "impressions") },
  };
}
