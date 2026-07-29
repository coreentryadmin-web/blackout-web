// Canonical no-store header set for live / auth-gated JSON reads.
//
// `CDN-Cache-Control: no-store` is the load-bearing header: a Cloudflare
// cache rule can `override_origin` and edge-cache a 200 that sets only
// `Cache-Control`. Without a CDN-scoped no-store, one member's live
// GEX / walls / spot snapshot (or auth/me payload) could be cached at the
// edge and served STALE — or to another member — until the edge TTL expires.
//
// `Cloudflare-CDN-Cache-Control` mirrors the middleware `withNoEdgeCache`
// set so both Origin Rules and Cache Rules that key on either header name
// honor the bypass.
//
// Import this constant — do not copy-paste inline Cache-Control blocks on
// new auth-gated or live market routes.
export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
} as const;

/** SSE / streaming responses: allow intermediaries to see the stream as no-cache,
 *  but never edge-store a completed body. */
export const NO_STORE_STREAM_HEADERS = {
  "Cache-Control": "no-cache, no-transform",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
} as const;
