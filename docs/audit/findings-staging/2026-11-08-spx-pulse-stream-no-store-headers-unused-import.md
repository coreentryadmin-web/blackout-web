> **kind:** FINDING

# `/api/market/spx/pulse/stream`'s SSE response never applied `NO_STORE_STREAM_HEADERS` — the import added by #1224 sat unused for CDN cache-control purposes

| | |
|---|---|
| **Area** | SPX pulse SSE stream — `src/app/api/market/spx/pulse/stream/route.ts` |
| **Severity** | P3 — a CDN-cache-safety regression, not a correctness/data-accuracy bug: no evidence this response is currently matched by a live Cloudflare cache rule, but it is auth-gated per-session data and every sibling SSE route already carries the guard |
| **Status** | FIXED |

## Root cause

PR #1224 ("close remaining CDN gaps + disable auth-gated GEX edge cache") added
`import { NO_STORE_HEADERS, NO_STORE_STREAM_HEADERS } from "@/lib/no-store-headers";` to this
route (and to every other stream/JSON route it touched) specifically so a Cloudflare cache rule
with `override_origin` can never edge-cache an auth-gated, per-session response under a stale/
shared copy — `NO_STORE_HEADERS`'/`NO_STORE_STREAM_HEADERS`'s own header comment calls
`CDN-Cache-Control`/`Cloudflare-CDN-Cache-Control: no-store` "the load-bearing header[s]" for
exactly this reason.

That PR added the import here but never actually applied it. The route's final response kept its
pre-#1224 hand-rolled headers object:

```ts
return new NextResponse(stream, {
  headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  },
});
```

— `"Cache-Control": "no-cache"` only, no `CDN-Cache-Control`/`Cloudflare-CDN-Cache-Control` at
all. `NO_STORE_HEADERS` was imported and never referenced anywhere in the file; `NO_STORE_STREAM_HEADERS`
was imported and also never referenced in the actual response.

Every sibling SSE stream route that same PR touched (and every one that exists today) spreads the
constant into its final `NextResponse` headers:

```ts
return new NextResponse(stream, {
  headers: {
    ...NO_STORE_STREAM_HEADERS,
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
  },
});
```

— confirmed in `flows/stream/route.ts`, `vector/stream/route.ts`, `gex-matrix-deltas/route.ts`,
`admin/apis/stream/route.ts`, and `stocks/spot-stream/route.ts`. `spx/pulse/stream/route.ts` was
the one holdout: it imported the constant (so it reads, at a glance, like every other fixed route)
but never spread it, so the actual wire response never got the CDN headers the import was added
for.

This slipped past `src/lib/no-store-headers.guard.test.ts`, the exact test PR #1224 added to
prevent routes from omitting the shared constant — but that guard only asserts a route file
**imports** `@/lib/no-store-headers` somewhere in its source; it never checks that the import is
actually used in a returned `Response`. A route that imports the constant and silently drops it
(exactly this file) still passes that guard clean.

## Evidence (RED → GREEN)

New tests in `src/app/api/market/spx/pulse/stream/route.test.ts` (source-level assertions, same
convention the existing tests in that file and `no-store-headers.guard.test.ts` already use — the
route pulls in live WebSocket/Redis client modules with real network side effects, so executing the
handler directly is out of scope per this repo's "extract pure logic for testability" convention):

```
git stash   (pre-fix route.ts, test added on top)
npx tsx --experimental-test-module-mocks --test src/app/api/market/spx/pulse/stream/route.test.ts
# not ok 4 - .../spx/pulse/stream actually SPREADS NO_STORE_STREAM_HEADERS...
# AssertionError: the SSE stream response must spread ...NO_STORE_STREAM_HEADERS...
# pass 3 / fail 1

git stash pop   (post-fix)
# ok 4 - .../spx/pulse/stream actually SPREADS NO_STORE_STREAM_HEADERS...
# pass 4 / fail 0
```

Also re-ran `src/lib/no-store-headers.guard.test.ts` (still green — the fix keeps the import, now
actually used) and `npx tsc --noEmit` (clean).

## Blast radius

Single call site: this route's one `NextResponse(stream, …)` return. No other file imports from
this route, and the fix changes only response headers (adds `CDN-Cache-Control`/
`Cloudflare-CDN-Cache-Control: no-store`, keeps `Cache-Control: no-cache, no-transform` from the
shared constant in place of the previous bespoke `"no-cache"` literal, keeps `Content-Type`/
`Connection` as before). No change to the SSE payload, the refresh cadence, the connection cap, or
any other route.

## Fix rationale

Spread `...NO_STORE_STREAM_HEADERS` into the response's headers object, mirroring the established,
already-shipped pattern in every sibling SSE route, and drop the now genuinely-unused
`NO_STORE_HEADERS` import (this file has no plain-JSON response that would need it — the 503 "too
many active streams" text response is also left header-bare here, matching every sibling route's
same choice for that non-cacheable path). Left deliberately unchanged: the guard test itself (a
broader "does every import get applied" static check would be valuable but is a separate,
larger-scope change than this single-route fix) and every other behavior in the file.
