import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Fix 2 (SEV-3): /api/market/nighthawk/horizons spliced getSwingServingLane() (UNROUNDED) into a
// board it re-derived without roundFloats — so once swings ship, raw provider floats (e.g.
// 7499.360000000001) leak straight into the horizon board even though the 0DTE lane is rounded
// upstream in zerodte-service. The response is now wrapped in roundFloats(...) at the boundary,
// the same backstop every sibling market route applies. This proves the wrap rounds BOTH the
// re-derived board and the spliced swing lane, while leaving integers (epoch millis) untouched.
//
// mock.module() resolves relative to THIS file (quote/regime route-test pattern). roundFloats is
// deliberately REAL here — the whole point is that the ROUTE applies it; the board builders and
// data sources are faked so a known malformed float can be injected and observed.

const RAW_BOARD_FLOAT = 7499.360000000001;
const RAW_SWING_FLOAT = 1234.5600000000004;
const EPOCH_MS = 1721835000000; // integer — must pass through roundFloats untouched

mock.module("../../../../../lib/db", {
  namedExports: { requireDatabaseInProduction: () => null },
});
mock.module("../../../../../lib/market-api-auth", {
  namedExports: { authorizeCronOrTierApi: async () => ({ via: "cron" as const }) },
});
mock.module("../../../../../lib/tool-access-server", {
  namedExports: { requireToolApi: async () => null },
});
mock.module("../../../../../lib/ws/init-data-sockets", {
  namedExports: { ensureDataSockets: () => {} },
});
mock.module("../../../../../lib/platform/zerodte-service", {
  namedExports: {
    getZeroDteBoardPayload: async () => ({
      as_of: "2026-07-24T15:30:00.000Z",
      upstream_ok: true,
      session: { epoch: EPOCH_MS },
    }),
  },
});
mock.module("../../../../../lib/zerodte/horizon-board-from-payload", {
  namedExports: {
    // A board carrying a raw float + an empty SWING lane placeholder (the shape the 0DTE payload
    // yields before the swing splice).
    horizonBoardFromZeroDtePayload: () => ({
      lanes: { SWING: { plays: [] } },
      generatedFloat: RAW_BOARD_FLOAT,
    }),
  },
});
mock.module("../../../../../lib/horizon-board", {
  // Identity scope so the test observes the route's rounding, not scoping math.
  namedExports: { scopeBoardToHorizon: (board: unknown) => board },
});
mock.module("../../../../../lib/swing/serving-lane", {
  namedExports: {
    getSwingServingLane: async () => ({ swingFloat: RAW_SWING_FLOAT, sections: [] }),
  },
});

describe("/api/market/nighthawk/horizons roundFloats at the boundary", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("the re-derived board's floats are rounded (no raw provider precision leaks)", async () => {
    const res = await GET(new NextRequest("http://localhost/api/market/nighthawk/horizons"));
    const body = await res.json();
    assert.equal(body.board.generatedFloat, 7499.36, "raw 7499.360000000001 must be rounded to 2dp");
  });

  test("the spliced SWING lane (the actual leak) is rounded too", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/market/nighthawk/horizons?view=swings")
    );
    const body = await res.json();
    assert.equal(body.board.lanes.SWING.swingFloat, 1234.56, "the unrounded swing lane must be rounded at the edge");
  });

  test("integer timestamps pass through untouched (roundFloats only trims float noise)", async () => {
    const res = await GET(new NextRequest("http://localhost/api/market/nighthawk/horizons"));
    const body = await res.json();
    assert.equal(body.session.epoch, EPOCH_MS);
    assert.equal(body.upstream_ok, true);
  });

  test("still ships no-store (behavior unchanged — rounding-only fix)", async () => {
    const res = await GET(new NextRequest("http://localhost/api/market/nighthawk/horizons"));
    assert.match(res.headers.get("Cache-Control") ?? "", /no-store/);
  });
});
