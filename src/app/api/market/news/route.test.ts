import { before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

// `/api/market/news` is gated by `authorizeMarketDeskApi` — a paid community-tier (or
// premium/cron) session is required. Its response must NEVER carry a shared/public cache
// directive: a Cloudflare (or other intermediary) cache that is allowed to serve the same
// cached body to a different, unauthenticated-or-lower-tier requester bypasses the auth
// check above entirely for the life of the cache entry — the exact CWE-863 shape
// `authorizeMarketDeskApi`'s own doc comment describes. See
// `docs/audit/findings-staging/2026-11-01-news-route-public-cache.md`.

mock.module("../../../../lib/market-api-auth", {
  namedExports: {
    authorizeMarketDeskApi: async () => ({ userId: "user_1", via: "user" as const }),
  },
});
mock.module("../../../../lib/providers/config", {
  namedExports: {
    polygonConfigured: () => true,
  },
});
mock.module("../../../../lib/providers/polygon", {
  namedExports: {
    fetchBenzingaNews: async () => [{ id: "1", title: "Test headline" }],
  },
});
mock.module("../../../../lib/server-cache", {
  namedExports: {
    serverCache: async (_key: string, _ttl: number, fn: () => unknown) => fn(),
    TTL: { NEWS: 120_000, TICKER_NEWS: 60_000 },
  },
});

describe("GET /api/market/news", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("never sets a shared/public Cache-Control on an auth-gated response (market-wide)", async () => {
    const res = await GET(new NextRequest("http://localhost/api/market/news"));
    assert.equal(res.status, 200);
    const cc = res.headers.get("Cache-Control") ?? "";
    // Regression guard: a public/shared directive here lets an edge cache serve this
    // community-tier-gated payload to an unauthenticated or lower-tier requester without
    // ever re-running authorizeMarketDeskApi.
    assert.doesNotMatch(cc, /\bpublic\b/, `Cache-Control must not be public/shared, got "${cc}"`);
    assert.match(cc, /no-store/);
  });

  test("never sets a shared/public Cache-Control on an auth-gated response (per-ticker)", async () => {
    const res = await GET(new NextRequest("http://localhost/api/market/news?ticker=NVDA"));
    assert.equal(res.status, 200);
    const cc = res.headers.get("Cache-Control") ?? "";
    assert.doesNotMatch(cc, /\bpublic\b/, `Cache-Control must not be public/shared, got "${cc}"`);
    assert.match(cc, /no-store/);
  });
});

test("news route requires market desk auth (source guard)", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/market/news/route.ts"), "utf8");
  assert.match(src, /authorizeMarketDeskApi/);
});
