/**
 * Pure classification helpers for the site audit tools.
 *
 * Kept separate from the crawl/render scripts (which are all I/O) so the
 * decisions that actually matter — is this a soft 404, is this URL a stream, is
 * this link internal — are unit-testable. Same split as e2e-schema-checks.mjs
 * and zerodte-healthcheck-eval.mjs.
 */

/** A 200 response that is really the not-found page.
 *  Invisible to a status-code-only crawl: /learn/<unknown> served exactly this
 *  on prod until `dynamicParams = false` landed, so the check earns its keep. */
const NOT_FOUND_MARKERS = [
  /This page could not be found/i,
  /<title>[^<]*\b404\b[^<]*<\/title>/i,
  /page-not-found/i,
];

const ERROR_MARKERS = [
  /Application error: a client-side exception/i,
  /Internal Server Error/i,
  /<title>[^<]*\b500\b[^<]*<\/title>/i,
];

/**
 * Endpoints that never terminate (SSE / long-poll).
 *
 * The sandbox's browser tunnel is one-shot request/response, so a stream leaves
 * the route handler unsettled and the page hangs until the screenshot deadline
 * blows — this is precisely how /nighthawk and /flows failed a capture run.
 * Render audits abort these deliberately and say so in their output.
 */
const STREAMING = /\/(stream|sse|events|subscribe)(\?|$)|\/api\/.*\/stream/i;

export const isStreamingUrl = (url) => STREAMING.test(String(url));
export const isSoftNotFound = (status, body) => status === 200 && NOT_FOUND_MARKERS.some((r) => r.test(body));
export const hasServerError = (body) => ERROR_MARKERS.some((r) => r.test(body));

/**
 * Resolve an href to a same-origin path, or null.
 *
 * Decodes HTML entities FIRST. An href in served HTML is escaped
 * (`?a=1&amp;b=2`); treating that literally makes every such link look like a
 * distinct URL, which inflates the crawl and manufactures fake "duplicate
 * title" findings. Observed for real: 52 phantom /pricing variants in one run.
 */
export function toInternalPath(href, base) {
  if (!href) return null;
  const decoded = String(href)
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/gi, '"');
  if (/^(#|mailto:|tel:|javascript:)/i.test(decoded)) return null;
  try {
    const u = new URL(decoded, base);
    if (u.origin !== new URL(base).origin) return null;
    return u.pathname + (u.search || "");
  } catch {
    return null;
  }
}

/** Normalise for dedupe: drop the fragment, drop tracking params. */
export function canonicalPath(path) {
  const [p, q = ""] = String(path).split("#")[0].split("?");
  if (!q) return p;
  const kept = q
    .split("&")
    .filter((kv) => kv && !/^(utm_[a-z]+|gclid|fbclid|ref)=/i.test(kv))
    .sort();
  return kept.length ? `${p}?${kept.join("&")}` : p;
}
