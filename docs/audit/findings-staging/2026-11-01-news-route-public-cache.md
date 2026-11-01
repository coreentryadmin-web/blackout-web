> **kind:** FINDING

## `GET /api/market/news` set `Cache-Control: public, s-maxage=120` on a paywalled, auth-gated response — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (access-control gap — CWE-863, confined to one route) |
| **File** | `src/app/api/market/news/route.ts` |
| **Lane** | Discovery audit (round 288) |

### Root cause

`GET /api/market/news` is gated by `authorizeMarketDeskApi(req)` — per that helper's own doc
comment in `src/lib/market-api-auth.ts`, this requires either the cron secret OR a **signed-in
community-tier-or-higher Clerk session** (a paid tier, "$49/mo" per the comment). That is the
**sole** enforcement point for this data: Next.js middleware only matches page paths, not
`/api/market/*`, so there is no second gate anywhere else in the request path.

Despite that, the route's success responses carried:

```ts
const CDN_CACHE = { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=30" };
```

`public` is a **shared-cache** directive — it explicitly tells Cloudflare (and any other
intermediary) that the response MAY be reused to satisfy a *different* requester's identical
request, for up to 120s, without re-contacting the origin. Concretely: once any one paying member
fetches `/api/market/news` (or `/api/market/news?ticker=NVDA`), an edge cache entry exists that an
unauthenticated visitor, or a signed-in user with no paid tier at all, hitting the exact same URL
could be served from — completely bypassing the `authorizeMarketDeskApi` check above for the life
of that cache entry. This is the identical failure shape `authorizeMarketDeskApi`'s own comment
already documents and warns about for a different, previously-fixed instance: "Twenty premium
routes... were wired to this community gate, letting a $49 community member pull $199 premium data
by hitting the API directly (CWE-863)." The vulnerability there was the wrong *tier* gate; here the
tier gate is correct, but a `public` cache directive on top of it reopens the exact same shape —
*no* gate at all for a cached hit.

### Evidence

- The repo's own canonical header module, `src/lib/no-store-headers.ts`, states exactly this risk
  in its top comment: *"a Cloudflare cache rule can `override_origin` and edge-cache a 200 that
  sets only `Cache-Control`. Without a CDN-scoped no-store, one member's live... payload could be
  cached at the edge and served STALE — or **to another member** — until the edge TTL expires."*
  and explicitly instructs: *"Import this constant — do not copy-paste inline Cache-Control blocks
  on new auth-gated or live market routes."*
- Grepped every route under `src/app/api/market/*` that uses `authorizeMarketDeskApi` or
  `authorizePremiumDeskApi` (every community- or premium-tier-gated market data route in the
  codebase): **every single one** uses `NO_STORE_HEADERS` (or, for the one SSE route,
  `NO_STORE_STREAM_HEADERS`) — except `news/route.ts`, the sole outlier.
- Compared against the one route in the same directory that genuinely has **no** auth check at
  all, `src/app/api/market/regime/route.ts` — its own comment: *"intentionally public (market-wide,
  no user-specific or paid-tier data...)"*. `regime`'s `public, s-maxage=30` is correct for an
  unauthenticated route; `news`'s identical-shaped header on an **authenticated, paid-tier-gated**
  route is not the same case.

### Blast radius

Only `src/app/api/market/news/route.ts` sets this header pattern among auth-gated market routes
(confirmed by the grep above — the only other non-test, non-SSE file without `NO_STORE_HEADERS`
under `authorizeMarketDeskApi`/`authorizePremiumDeskApi` was this one). No other route needed the
same fix this round.

### Fix rationale

Replaced the inline `public, s-maxage=120, stale-while-revalidate=30` header with the canonical
`NO_STORE_HEADERS` import (`CDN-Cache-Control`/`Cloudflare-CDN-Cache-Control: no-store` alongside a
no-store `Cache-Control`), matching every sibling auth-gated route. This does **not** reopen the
"every member poll hits Benzinga" problem the CDN cache was trying to solve: `serverCache(...)`
(already called on both response paths) is a process-wide, TTL-keyed cache shared across every
concurrent requester — it already dedupes upstream Benzinga/Polygon calls for the same TTL window
regardless of any CDN header. Removing the edge-cache header only removes the *shared, bypasses-
auth* layer on top of that; it does not remove caching, it removes the layer that ignored the auth
boundary.

Left unchanged: the per-ticker TTL-in-milliseconds fix noted in the route's own existing comment
(unrelated prior fix, already correct), the 502/503 error paths (never had a cache header to begin
with), and every other market route (already on the canonical headers).

### Regression test

`src/app/api/market/news/route.test.ts` (new file) mocks `authorizeMarketDeskApi`,
`polygonConfigured`, `fetchBenzingaNews`, and `serverCache`, then asserts the GET response's
`Cache-Control` header never contains `public` and always contains `no-store`, for both the
market-wide and per-ticker code paths. Verified RED against the pre-fix route (via `git stash` on
just the route file) — both assertions failed with the literal
`"public, s-maxage=120, stale-while-revalidate=30"` value — and GREEN after the fix.
