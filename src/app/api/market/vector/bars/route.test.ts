import { before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

mock.module("../../../../../lib/market-api-auth", {
  namedExports: {
    authorizePremiumDeskApi: async () => ({ userId: "user_1", via: "user" as const }),
  },
});
mock.module("../../../../../lib/tool-access-server", {
  namedExports: {
    requireToolApi: async () => null,
  },
});
mock.module("../../../../../features/vector/lib/vector-seed-bars", {
  namedExports: {
    fetchVectorSeedBars: async () => ({
      bars: [{ t: 1_700_000_000, o: 100, h: 101, l: 99, c: 100.5, v: 1000 }],
      sessionYmd: "2026-08-14",
    }),
  },
});

describe("GET /api/market/vector/bars", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("returns no-store headers and rounded bars", async () => {
    const res = await GET(new NextRequest("http://localhost/api/market/vector/bars?ticker=SPX"));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("Cache-Control") ?? "", /no-store/);
    const body = await res.json();
    assert.equal(body.sessionYmd, "2026-08-14");
    assert.ok(Array.isArray(body.bars));
  });

  test("rejects invalid ticker", async () => {
    const res = await GET(new NextRequest("http://localhost/api/market/vector/bars?ticker=!!!"));
    assert.equal(res.status, 400);
  });
});

test("bars route ships NO_STORE_HEADERS (source guard)", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/market/vector/bars/route.ts"), "utf8");
  assert.match(src, /NO_STORE_HEADERS/);
  assert.match(src, /roundFloats/);
});
