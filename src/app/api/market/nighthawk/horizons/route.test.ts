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

mock.module("server-only", { namedExports: {} });
mock.module("../../../../../lib/vector/vector-pick-leaders-db", {
  namedExports: { fetchVectorPickLeaderRows: async () => [] },
});
mock.module("../../../../../lib/banger/flag", {
  namedExports: { isBangerEngineEnabled: () => false },
});
mock.module("../../../../../lib/banger/positions-db", {
  namedExports: { fetchBangerBoardRows: async () => [], fetchBangerOpenBookRows: async () => [] },
});
mock.module("../../../../../lib/banger/watch-cache", {
  namedExports: { readBangerWatchSnapshot: async () => null },
});
mock.module("../../../../../lib/et-date", {
  namedExports: { todayEt: () => "2026-09-04" },
});

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
// Penny-priced Banger-origin contract (banger-lane-merge.ts's shape): entry/mark sub-$1, and
// livePnlPct already computed upstream from the RAW (unrounded) entry/mark — see the SEV note
// below on why 2dp default rounding of mid/entryPremium/peakPremium breaks the displayed pair.
const PENNY_ENTRY = 0.15;
const PENNY_MARK = 0.125; // rounds to 0.13 at 2dp — a live-repro value (RBLU 2026-09-15)
const PENNY_LIVE_PNL_PCT = -16.7; // Math.round(((0.125/0.15 - 1) * 100) * 10) / 10, computed pre-rounding

// Deep-ITM near-expiry swing contract greeks (AAPL 1DTE 330C shape flagged live 2026-09-20): real,
// honestly-computed small-but-nonzero values that the OLD 2dp default rounding destroyed to 0.00 —
// see the "gamma/theta/vega ALSO need the override" test below.
const REAL_GAMMA = 0.0031;
const REAL_THETA = -0.0087;
const REAL_VEGA = 0.0054;
const REAL_IV = 0.1823;

mock.module("../../../../../lib/swing/serving-lane", {
  namedExports: {
    getSwingServingLane: async () => ({
      swingFloat: RAW_SWING_FLOAT,
      sections: [],
      committedCount: 2,
      watchCount: 3,
      scanAsOf: "2026-09-04T17:00:00.000Z",
      scanSessionDay: "2026-09-04",
      committed: [
        {
          ticker: "PENNY",
          entryPremium: PENNY_ENTRY,
          peakPremium: PENNY_MARK,
          livePnlPct: PENNY_LIVE_PNL_PCT,
          contract: {
            mid: PENNY_MARK,
            gamma: REAL_GAMMA,
            theta: REAL_THETA,
            vega: REAL_VEGA,
            iv: REAL_IV,
          },
        },
      ],
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
    assert.equal(body.board.lanes.SWING.scanAsOf, "2026-09-04T17:00:00.000Z");
    assert.equal(body.board.lanes.SWING.scanSessionDay, "2026-09-04");
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

  // SEV: penny-priced Banger-origin premiums (entryPremium/contract.mid/peakPremium) were rounded
  // to the default 2dp at this response boundary, but livePnlPct is computed upstream in
  // banger-lane-merge.ts from the RAW unrounded entry/mark BEFORE this rounding runs. For a
  // sub-$1 contract that gap is large enough to be visible: raw mark 0.125 rounds to displayed
  // 0.13, so a member reading "entry $0.15, mark $0.13" and computing (0.13-0.15)/0.15 gets
  // -13.3%, while the API's own livePnlPct field says -16.7% (computed from the real 0.125) —
  // live repro RBLU 2026-09-15. Fix: keyDp overrides mid/entryPremium/peakPremium to 4dp (same
  // precedent as round-floats.ts's own gamma override) so displayed premiums stay close enough
  // to the raw value that recomputing the percentage from them agrees with livePnlPct.
  test("penny-priced premiums keep enough precision that (mark-entry)/entry agrees with livePnlPct", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/market/nighthawk/horizons?view=swings")
    );
    const body = await res.json();
    const play = body.board.lanes.SWING.committed[0];
    assert.equal(play.livePnlPct, PENNY_LIVE_PNL_PCT);
    const recomputed = ((play.contract.mid / play.entryPremium - 1) * 100);
    assert.ok(
      Math.abs(recomputed - play.livePnlPct) < 0.5,
      `displayed mid ${play.contract.mid} / entry ${play.entryPremium} implies ${recomputed.toFixed(1)}%, ` +
        `too far from the API's own livePnlPct ${play.livePnlPct}% — precision lost at the rounding boundary`
    );
  });

  // BUG (Ask Largo standing mandate, flagged live 2026-09-20 on an AAPL 1DTE deep-ITM 330C swing
  // position): live-plays.ts honestly computes/carries real, small-but-nonzero gamma/theta/vega
  // off the live provider quote (never fabricated - `quote?.gamma ?? null`), but this route's
  // roundFloats() call had no keyDp override for those keys, so the 2dp default silently
  // quantized every one of them to 0.00 before they ever reached the member/Largo response - a
  // real computed greek rendering as a confident "0", indistinguishable from a genuinely-absent
  // quote. This is the exact hazard round-floats.ts's own header warns about for gamma and the
  // fix vector-response-rounding.ts already applies for Vector's fraction-scale fields; the
  // horizons route cited that precedent in a comment but never actually added the override.
  test("gamma/theta/vega/iv keep 4dp precision instead of quantizing to 0.00 (Ask Largo audit, 2026-09-21)", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/market/nighthawk/horizons?view=swings")
    );
    const body = await res.json();
    const play = body.board.lanes.SWING.committed[0];
    assert.equal(play.contract.gamma, REAL_GAMMA, "gamma must not be destroyed to 0.00");
    assert.equal(play.contract.theta, REAL_THETA, "theta must not be destroyed to 0.00");
    assert.equal(play.contract.vega, REAL_VEGA, "vega must not be destroyed to 0.00");
    assert.equal(play.contract.iv, REAL_IV, "iv must keep 4dp precision");
  });
});
