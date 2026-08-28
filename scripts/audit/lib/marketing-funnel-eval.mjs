/**
 * Pure evaluators for marketing ↔ checkout commercial integrity.
 * Used by marketing-funnel-audit.mjs and unit tests — keeps forbidden-copy
 * guards testable without a live browser.
 */

/** Copy that must never ship again after the Aug 2026 P0 Whop mismatch. */
export const FORBIDDEN_MARKETING_STRINGS = [
  { id: "whop-excludes-spx", pattern: /Does not include SPX Slayer/i, scope: "whop-remodel + public copy" },
  { id: "community-75", pattern: /Community.*\$75|\$75\/mo.*Discord-only|Discord-only.*\$75/i, scope: "pricing funnel" },
  { id: "discord-community-title", pattern: /BlackOut Discord Community/i, scope: "Whop product title" },
];

/** @param {string} text @param {typeof FORBIDDEN_MARKETING_STRINGS[number]} rule */
export function findForbiddenMatch(text, rule) {
  const m = text.match(rule.pattern);
  return m ? { id: rule.id, match: m[0], scope: rule.scope } : null;
}

/** @param {string} text */
export function scanForbiddenMarketingCopy(text) {
  /** @type {Array<{ id: string, match: string, scope: string }>} */
  const hits = [];
  for (const rule of FORBIDDEN_MARKETING_STRINGS) {
    const found = findForbiddenMatch(text, rule);
    if (found) hits.push(found);
  }
  return hits;
}

/** @param {{ community: number, monthly: number, yearly: number }} pricing */
export function expectedWhopPriceMentions(pricing) {
  return {
    spx: `$${pricing.community}`,
    monthly: `$${pricing.monthly}`,
    yearly: `$${pricing.yearly}`,
  };
}

/** @param {string} whopScript @param {{ community: number, monthly: number, yearly: number }} pricing */
export function whopScriptPriceParity(whopScript, pricing) {
  /** @type {string[]} */
  const missing = [];
  const want = expectedWhopPriceMentions(pricing);
  if (!whopScript.includes(want.spx)) missing.push(`SPX ${want.spx}`);
  if (!whopScript.includes(want.monthly)) missing.push(`monthly ${want.monthly}`);
  const yearlyPlain = String(pricing.yearly);
  const yearlyFormatted = pricing.yearly.toLocaleString("en-US");
  if (!whopScript.includes(yearlyPlain) && !whopScript.includes(yearlyFormatted)) {
    missing.push(`yearly ${yearlyPlain}`);
  }
  if (!/BlackOut SPX Slayer/i.test(whopScript)) missing.push("product title BlackOut SPX Slayer");
  return missing;
}

/** @param {string} html — gamma widget region text must not show loading + freshness together */
export function gammaLoadingFreshnessConflict(text) {
  const lower = text.toLowerCase();
  const hasLoading = /loading/.test(lower);
  const hasLevels = /levels computed|updated/i.test(lower);
  return hasLoading && hasLevels;
}

/** @param {number | null | undefined} h1TopPx — distance from viewport top */
export function homepageH1AboveFold(h1TopPx, maxTopPx = 420) {
  if (h1TopPx == null || !Number.isFinite(h1TopPx)) return { ok: false, reason: "H1 not measured" };
  if (h1TopPx > maxTopPx) return { ok: false, reason: `H1 starts at ${Math.round(h1TopPx)}px (max ${maxTopPx})` };
  return { ok: true, reason: `H1 at ${Math.round(h1TopPx)}px` };
}

/** Anonymous /upgrade HTML must not SSR the paid-sync CTA before Clerk hydrates. */
export function upgradeAnonSyncGate(html) {
  const hasSignIn = /Sign in to sync/i.test(html);
  const hasPaidButton = /I paid|refresh my access/i.test(html);
  if (hasSignIn && !hasPaidButton) {
    return { ok: true, reason: "anonymous upgrade shows sign-in sync path" };
  }
  if (!hasSignIn && hasPaidButton) {
    return { ok: false, reason: "paid sync exposed in anonymous HTML" };
  }
  if (hasSignIn && hasPaidButton) {
    return { ok: false, reason: "both sign-in and paid sync CTAs present" };
  }
  return { ok: false, reason: "no sync CTA found" };
}

/** Public methodology trust page must be live with grading copy. */
export function methodologyPageGate(html, status = 200) {
  if (status !== 200) {
    return { ok: false, reason: `HTTP ${status}` };
  }
  const hasTitle = /Grading methodology|Public record/i.test(html);
  const hasAntiBlend = /never blended|three methodologies/i.test(html);
  if (hasTitle && hasAntiBlend) {
    return { ok: true, reason: "methodology page live with anti-blend copy" };
  }
  return { ok: false, reason: "methodology page missing expected trust copy" };
}

/** Live sitemap must list trust surfaces (stale CF edge cache is a common miss). */
export function sitemapMethodologyGate(xml, baseUrl) {
  if (!/<urlset/i.test(xml)) {
    return { ok: false, reason: "not a sitemap urlset" };
  }
  const origin = baseUrl.replace(/\/$/, "");
  const required = [`${origin}/methodology`, `${origin}/learn`];
  const missing = required.filter((u) => !xml.includes(u));
  if (missing.length) {
    return { ok: false, reason: `missing URLs: ${missing.map((u) => u.replace(origin, "")).join(", ")}` };
  }
  return { ok: true, reason: "methodology + learn in sitemap" };
}

/** Deploy purge list must include new trust/marketing URLs or edge serves stale SEO. */
export function cfPurgeTrustPagesGate(source) {
  const required = [
    "/methodology",
    "/why-blackout",
    "/vs/others",
    "/tools/gamma-snapshot",
    "/sitemap.xml",
  ];
  const missing = required.filter((p) => !source.includes(`"${p}"`) && !source.includes(`'${p}'`));
  if (missing.length) {
    return { ok: false, reason: `cf-purge missing: ${missing.join(", ")}` };
  }
  return { ok: true, reason: "cf-purge includes trust + sitemap URLs" };
}
