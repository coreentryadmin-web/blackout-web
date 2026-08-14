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
mock.module("../../../../../features/vector/lib/vector-snapshot", {
  namedExports: {
    getVectorGexWallsForHorizon: async () => ({
      callWalls: [{ strike: 6000, pct: 0.2 }],
      putWalls: [{ strike: 5900, pct: 0.18 }],
    }),
    getVectorGammaFlipForHorizon: async () => 5950,
  },
});

describe("GET /api/market/vector/walls", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("returns walls + flip with no-store headers", async () => {
    const res = await GET(new NextRequest("http://localhost/api/market/vector/walls?ticker=SPX&dte=0dte"));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("Cache-Control") ?? "", /no-store/);
    const body = await res.json();
    assert.equal(body.flip, 5950);
    assert.ok(body.walls?.callWalls?.length);
  });
});

test("walls route requires premium desk auth (source guard)", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/market/vector/walls/route.ts"), "utf8");
  assert.match(src, /authorizePremiumDeskApi/);
  assert.match(src, /requireToolApi\("vector"\)/);
});
