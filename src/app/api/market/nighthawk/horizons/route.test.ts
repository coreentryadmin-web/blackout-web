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
  namedExports: {
    requireDatabaseInProduction: () => null,
    fetchOpenSwingPositions: async () => [],
    fetchLatestSwingSnapshotEvents: async () => new Map(),
  },
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
      // Totals describe the ZERO_DTE lane ONLY — that is exactly the pre-splice shape whose staleness
      // the withLane fix exists to correct.
      lanes: {
        SWING: { plays: [], committedCount: 0, watchCount: 0 },
        ZERO_DTE: { plays: [], committedCount: 1, watchCount: 0 },
        LEAPS: { plays: [], committedCount: 0, watchCount: 0 },
      },
      totalCommitted: 1,
      totalWatch: 0,
      generatedFloat: RAW_BOARD_FLOAT,
    }),
  },
});
mock.module("../../../../../lib/horizon-board", {
  // Identity scope so the test observes the route's rounding, not scoping math.
  namedExports: {
    scopeBoardToHorizon: (board: unknown) => board,
    assembleHorizonBoard: (_set: unknown, asOf: string) => ({
      asOf,
      lanes: {
        SWING: { plays: [], committedCount: 0, watchCount: 0 },
        ZERO_DTE: { plays: [], committedCount: 0, watchCount: 0 },
        LEAPS: { plays: [], committedCount: 0, watchCount: 0 },
      },
      totalCommitted: 0,
      totalWatch: 0,
      generatedFloat: RAW_BOARD_FLOAT,
    }),
    makePlaySet: (parts: unknown) => parts,
    // Mirrors the real helper (horizon-board.test.ts owns its unit coverage): swap the lane, then
    // re-derive the totals from ALL lanes rather than carrying the pre-splice ones forward.
    withLane: (
      board: { lanes: Record<string, { committedCount?: number; watchCount?: number }> },
      horizon: string,
      lane: unknown
    ) => {
      const lanes = { ...board.lanes, [horizon]: lane } as Record<
        string,
        { committedCount?: number; watchCount?: number }
      >;
      let totalCommitted = 0;
      let totalWatch = 0;
      for (const l of Object.values(lanes)) {
        totalCommitted += l.committedCount ?? 0;
        totalWatch += l.watchCount ?? 0;
      }
      return { ...board, lanes, totalCommitted, totalWatch };
    },
  },
});
mock.module("../../../../../lib/swing/serving-lane", {
  namedExports: {
    getSwingServingLane: async () => ({
      swingFloat: RAW_SWING_FLOAT,
      sections: [],
      committedCount: 2,
      watchCount: 3,
    }),
    // Route also reads the persisted snapshot / discover seam — stub so the mock module shape matches
    // the live import list (missing named exports → TypeError → degraded {available:false} body).
    discoverSwingFromPersisted: async () => null,
    readSwingServingSnapshot: async () => null,
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

  // The SWING lane is spliced in AFTER the board is assembled from the 0DTE payload, so the board's
  // totals have to be re-derived at that point. A plain object spread did not, and the all-lanes view
  // (?view absent → scopeBoardToHorizon is a documented no-op) had nothing downstream to fix them.
  test("board totals count the spliced SWING lane, not just the 0DTE lane it was assembled from", async () => {
    const res = await GET(new NextRequest("http://localhost/api/market/nighthawk/horizons"));
    const body = await res.json();
    assert.equal(body.board.totalCommitted, 3, "0DTE 1 + SWING 2 — not the pre-splice 1");
    assert.equal(body.board.totalWatch, 3, "0DTE 0 + SWING 3 — not the pre-splice 0");
  });

  test("still ships no-store (behavior unchanged — rounding-only fix)", async () => {
    const res = await GET(new NextRequest("http://localhost/api/market/nighthawk/horizons"));
    assert.match(res.headers.get("Cache-Control") ?? "", /no-store/);
  });
});
