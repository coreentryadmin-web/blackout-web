/**
 * Pure evaluation helpers for the staging-index check.
 *
 * WHY split out: the live script talks to GSC + prod over the network and cannot be unit-tested
 * in the sandbox, but the two decisions that actually matter — "which served rows are staging?"
 * and "does this state close the finding or keep it open?" — are pure and must not regress.
 *
 * The finding (P2, SEO): staging.blackouttrades.com was decommissioned 2026-07-25 but its DNS
 * record still resolves (proxied through Cloudflare with no origin → HTTP 530), and Google still
 * serves ~8 staging URLs in results. A dead link carrying the brand is a credibility problem, not
 * just a ranking one. Absence is the close condition: when GSC serves zero staging rows AND the
 * host no longer 2xx/5xx-resolves, the finding is closeable.
 */

/** A GSC searchAnalytics row's page key is on the staging host? */
export function isStagingPage(pageUrl, host = "staging.blackouttrades.com") {
  if (typeof pageUrl !== "string") return false;
  try {
    return new URL(pageUrl).host === host;
  } catch {
    // Fall back to a substring test only for a clearly-formed host token, never a bare match
    // (so "notstaging.example" or a query param mentioning the word cannot false-positive).
    return pageUrl.includes(`//${host}/`) || pageUrl.includes(`//${host}`);
  }
}

/** Filter GSC rows (shape: {keys:[page], clicks, impressions, position}) to staging pages only. */
export function filterStagingRows(rows, host = "staging.blackouttrades.com") {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r && Array.isArray(r.keys) && isStagingPage(r.keys[0], host));
}

/** Aggregate staging rows into totals for the report. */
export function summarizeStaging(rows) {
  const clicks = rows.reduce((s, r) => s + (Number(r.clicks) || 0), 0);
  const impressions = rows.reduce((s, r) => s + (Number(r.impressions) || 0), 0);
  return { urls: rows.length, clicks, impressions };
}

/**
 * The verdict. `served` = # staging URLs GSC still returns; `hostResolves` = the host still
 * answers on the network (any status, incl. the 530 it serves today). The finding is only
 * CLOSEABLE when Google has stopped serving staging AND the host is gone — a live 530 with zero
 * GSC rows is still OPEN, because Google can re-surface a cached URL and a 5xx keeps it "temporary".
 */
export function stagingVerdict({ served, hostResolves }) {
  if (served > 0) return { status: "OPEN", reason: `${served} staging URL(s) still served by Google` };
  if (hostResolves) return { status: "OPEN", reason: "0 served, but host still resolves (add redirect or delete DNS to finish de-indexing)" };
  return { status: "CLOSEABLE", reason: "0 staging URLs served and host no longer resolves" };
}
