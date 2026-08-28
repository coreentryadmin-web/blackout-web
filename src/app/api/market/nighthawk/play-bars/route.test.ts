import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Auth/tool-gate faked to "cron" (always allowed) so these tests exercise the route's OWN
// validation (OCC pattern, since parsing, trading-day derivation) and response shaping, not the
// shared auth helpers those already have their own coverage.
mock.module("../../../../../lib/market-api-auth", {
  namedExports: { authorizeCronOrTierApi: async () => ({ userId: null, via: "cron" as const }) },
});
mock.module("../../../../../lib/tool-access-server", {
  namedExports: { requireToolApi: async () => null },
});

const FAKE_BARS = [
  { t: Date.parse("2026-08-28T14:30:00.000Z"), o: 4.0, h: 4.1, l: 3.9, c: 4.0 }, // before entry — must be trimmed
  { t: Date.parse("2026-08-28T14:35:00.000Z"), o: 4.2, h: 4.3, l: 4.1, c: 4.2 }, // = entry instant
  { t: Date.parse("2026-08-28T14:36:00.000Z"), o: 4.2, h: 4.5, l: 4.2, c: 4.4 },
  { t: Date.parse("2026-08-28T14:37:00.000Z"), o: 4.4, h: 4.4, l: 4.0, c: 4.1 },
];
let lastFetchArgs: unknown[] | null = null;
let failNext = false;
mock.module("../../../../../lib/providers/polygon", {
  namedExports: {
    fetchOptionMinuteBars: async (...args: unknown[]) => {
      lastFetchArgs = args;
      if (failNext) throw new Error("Polygon /v2/aggs/... → 429 (rate limited)");
      return FAKE_BARS;
    },
  },
});

function req(qs: string): NextRequest {
  return new NextRequest(`https://blackouttrades.com/api/market/nighthawk/play-bars?${qs}`);
}

describe("/api/market/nighthawk/play-bars", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("rejects a malformed occ before ever calling Polygon", async () => {
    lastFetchArgs = null;
    const res = await GET(req("occ=NOT_AN_OCC_SYMBOL&since=2026-08-28T14:35:00.000Z"));
    assert.equal(res.status, 400);
    assert.equal(lastFetchArgs, null);
  });

  test("rejects a missing/invalid since", async () => {
    const res = await GET(req("occ=O:NVDA260828C00190000&since=not-a-date"));
    assert.equal(res.status, 400);
  });

  test("happy path trims pre-entry bars, maps to {t,c} ISO points, derives the Polygon day-range from `since`", async () => {
    lastFetchArgs = null;
    const res = await GET(req("occ=o:nvda260828c00190000&since=2026-08-28T14:35:00.000Z"));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { occ: string; since: string; points: Array<{ t: string; c: number }> };

    // occ is uppercased regardless of request casing.
    assert.equal(body.occ, "O:NVDA260828C00190000");
    // The one pre-entry bar (14:30) is gone; the other three (>= 14:35) survive, in order.
    assert.deepEqual(
      body.points.map((p) => p.c),
      [4.2, 4.4, 4.1],
    );
    assert.equal(body.points[0]!.t, "2026-08-28T14:35:00.000Z");

    // fetchOptionMinuteBars got the uppercased OCC symbol and the SAME calendar day for from/to
    // (a 0DTE contract's whole tradable life is one day — see the route's own header comment).
    assert.deepEqual(lastFetchArgs, ["O:NVDA260828C00190000", "2026-08-28", "2026-08-28"]);
  });

  test("an upstream Polygon failure degrades to a 502, never a fabricated body", async () => {
    // A DIFFERENT occ+day than the happy-path test above — withServerCache keys on both, and a
    // shared key would let this test silently hit that test's already-cached SUCCESS instead of
    // actually exercising the failure path.
    failNext = true;
    try {
      const res = await GET(req("occ=O:TSLA260901P00250000&since=2026-09-01T14:35:00.000Z"));
      assert.equal(res.status, 502);
    } finally {
      failNext = false;
    }
  });
});
