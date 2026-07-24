import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

// Covers two of the three Night Hawk data-correctness fixes on the Vector market reads:
//
//  Fix 1 (SEV-2, no-store): the Vector market-data JSON routes shipped NO Cache-Control,
//  so a Cloudflare `/api/market/*` cache rule could edge-cache one member's live GEX/walls/
//  spot 200 and serve it STALE to everyone (the same override_origin edge-cache class the
//  auth-dependent-HTML gotcha hit). Every read now ships NO_STORE_HEADERS (Cache-Control +
//  CDN-Cache-Control: no-store) — the CDN-scoped header is the one that defeats an edge rule.
//
//  Fix 3 (SEV-4, asOf): the gex-ladder scoped (narrowed-DTE) branch hardcoded `asOf: null`,
//  so the ladder panel had no freshness stamp when a DTE horizon was selected. It now threads
//  the positioning snapshot's real ISO time (getHorizonStrikeTotals → pos.asof), the same
//  timestamp class the "all"/heatmap fallback branch already surfaced via hm.asof.
//
// mock.module() resolves bare specifiers relative to THIS file (see the quote/regime route
// tests). The pure modules (vector-ticker, vector-dte-horizon, round-floats, no-store-headers)
// run for real; only the auth gates + data sources are faked.

const SCOPED_ASOF = "2026-07-24T15:30:00.000Z";
const HM_ASOF = "2026-07-24T15:31:00.000Z";

mock.module("../../../../../lib/market-api-auth", {
  namedExports: {
    authorizeMarketDeskApi: async () => ({ userId: "user_1", via: "user" as const }),
  },
});
mock.module("../../../../../lib/tool-access-server", {
  namedExports: {
    requireToolApi: async () => null, // not locked
  },
});
mock.module("../../../../../features/vector/lib/vector-dte-walls-server", {
  namedExports: {
    getHorizonStrikeTotals: async () => ({
      spot: 100,
      strikeTotals: { "100": 1.5 },
      asOf: SCOPED_ASOF,
    }),
  },
});
mock.module("../../../../../lib/providers/polygon-options-gex", {
  namedExports: {
    fetchGexHeatmap: async () => ({
      spot: 101,
      asof: HM_ASOF,
      gex: { strike_totals: { "101": 2.5 } },
    }),
  },
});
// Decouple from the ladder-banding math — this test is about headers + asOf, not row shaping.
mock.module("../../../../../features/vector/lib/vector-gex-ladder", {
  namedExports: { buildGexLadder: () => [] },
});

describe("/api/market/vector/gex-ladder no-store + asOf freshness", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("scoped (narrowed-DTE) branch ships no-store headers", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/market/vector/gex-ladder?ticker=SPX&dte=0DTE")
    );
    assert.match(res.headers.get("Cache-Control") ?? "", /no-store/);
    assert.equal(res.headers.get("CDN-Cache-Control"), "no-store");
  });

  test("scoped branch threads the real snapshot asOf (Fix 3 — was hardcoded null)", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/market/vector/gex-ladder?ticker=SPX&dte=0DTE")
    );
    const body = await res.json();
    assert.equal(body.horizon, "0dte");
    assert.equal(body.asOf, SCOPED_ASOF, "narrowed-DTE ladder must carry a freshness timestamp, not null");
    assert.notEqual(body.asOf, null);
    assert.equal(body.spot, 100);
  });

  test('"all" branch still surfaces the heatmap asof + no-store headers', async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/market/vector/gex-ladder?ticker=SPX&dte=ALL")
    );
    assert.equal(res.headers.get("CDN-Cache-Control"), "no-store");
    const body = await res.json();
    assert.equal(body.horizon, "all");
    assert.equal(body.asOf, HM_ASOF);
  });

  test("junk ticker 400 is also no-store (never edge-cacheable)", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/market/vector/gex-ladder?ticker=%20%20")
    );
    assert.equal(res.status, 400);
    assert.equal(res.headers.get("CDN-Cache-Control"), "no-store");
  });
});

// Fix 1 completeness guard: every Vector market read + the indices read must apply
// NO_STORE_HEADERS. A source sweep (edition-route.test.ts pattern) so a NEW market route
// added without the guard — or a header quietly deleted — fails CI, protecting the whole
// `/api/market/*` surface from the edge-cache-a-live-member's-snapshot class, not just the
// one route this file exercises behaviorally.
describe("Fix 1: all Vector market reads + indices ship NO_STORE_HEADERS", () => {
  const routes = [
    "src/app/api/market/vector/walls/route.ts",
    "src/app/api/market/vector/gex-ladder/route.ts",
    "src/app/api/market/vector/gex-heatmap/route.ts",
    "src/app/api/market/vector/max-pain/route.ts",
    "src/app/api/market/vector/expected-move/route.ts",
    "src/app/api/market/vector/bars/route.ts",
    "src/app/api/market/vector/prior-day/route.ts",
    "src/app/api/market/vector/spy-volume/route.ts",
    "src/app/api/market/vector/wall-history/route.ts",
    "src/app/api/market/vector/flow/route.ts",
    "src/app/api/market/indices/route.ts",
  ];

  for (const rel of routes) {
    test(`${rel} imports + applies NO_STORE_HEADERS`, () => {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      assert.match(
        src,
        /import \{ NO_STORE_HEADERS \} from "@\/lib\/no-store-headers"/,
        "must import the shared no-store header set"
      );
      assert.match(src, /headers: NO_STORE_HEADERS/, "must apply NO_STORE_HEADERS to its response(s)");
    });
  }
});
