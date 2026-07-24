// Canonical no-store header set for live market-data JSON reads.
//
// `CDN-Cache-Control: no-store` is the load-bearing header here: a Cloudflare
// `/api/market/*` cache rule can `override_origin` and edge-cache a 200 that sets
// only `Cache-Control` (this is exactly the auth-dependent-HTML edge-cache class
// documented in CLAUDE.md). Without a CDN-scoped no-store, one member's live
// GEX / walls / spot / max-pain snapshot could be cached at the edge and served
// STALE to every other member until the edge TTL expires. Every live market read
// must ship this so no per-request data response is ever edge-cacheable.
//
// This mirrors the exact set the zerodte board/record/calibration routes already
// ship; centralized here so the Vector market reads (and any future market route)
// import one canonical definition instead of copy-pasting the block.
export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
} as const;
