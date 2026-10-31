import { test, mock, before } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { GET as GetFn } from "./route.ts";

/**
 * Regression: `GexPositioning.nearest_wall.kind` (src/lib/providers/gex-positioning.ts, and the
 * shared `nearestWallFromLevels` helper it delegates to in gex-nearest-wall.ts) is typed and
 * always populated as `"resistance" | "support"` — never `"call"` or `"put"`. This route's own
 * mobile-facing contract instead compared `nw.kind` directly against the literals `"call"`/
 * `"put"`:
 *
 *   const kind: "call" | "put" | null =
 *     nw?.kind === "call" || nw?.kind === "put" ? nw.kind : null;
 *
 * Since the source value is never "call" or "put", that comparison can never match — `kind` is
 * always null, so `nearestWall` in the response is always null, even when the backend genuinely
 * has a nearest wall (a valid strike + distance). The native iOS Watchlist row detail sheet's
 * "nearest wall" field was silently dead for every ticker, every time, with no error anywhere —
 * exactly the kind of absence-as-fact bug this repo's own CLAUDE.md keeps recording elsewhere.
 *
 * Fix: map the source's "resistance"/"support" vocabulary to this contract's "call"/"put"
 * vocabulary (resistance strike == call_wall, support strike == put_wall — confirmed against
 * nearestWallFromLevels, which assigns kind:"resistance" to the callWall candidate and
 * kind:"support" to the putWall candidate) instead of comparing against the wrong literals.
 *
 * mock.module() resolves bare specifiers relative to THIS file, not the "@/" tsconfig alias —
 * same pattern as src/app/api/market/gex-heatmap/route.test.ts.
 */

mock.module("server-only", { namedExports: {} });
mock.module("../../../../../lib/market-api-auth", {
  namedExports: {
    authorizeMarketDeskApi: async () => ({ userId: "user_1", via: "user" as const }),
  },
});

type MockPositioning = Record<string, unknown> | null;
let mockPositioning: MockPositioning = null;

mock.module("../../../../../lib/providers/gex-positioning", {
  namedExports: {
    getGexPositioning: async () => mockPositioning,
  },
});

let GET: typeof GetFn;
before(async () => {
  ({ GET } = await import("./route.ts"));
});

function makeReq(): NextRequest {
  return new NextRequest("https://blackouttrades.test/api/mobile/ticker/SPY");
}

test("mobile ticker route: nearestWall survives the resistance/support source vocabulary", async () => {
  mockPositioning = {
    spot: 580,
    change_pct: 0.5,
    asof: "2026-10-26T14:30:00.000Z",
    flip: 575,
    call_wall: 590,
    put_wall: 560,
    max_pain: 578,
    gamma_posture: "long",
    gamma_regime_read: "Positive gamma",
    degraded: false,
    // Nearest wall is the call wall here (590 is 10pts away vs put wall's 20pts).
    nearest_wall: { strike: 590, kind: "resistance", distance_pts: 10 },
  };

  const res = await GET(makeReq(), { params: Promise.resolve({ ticker: "SPY" }) });
  const body = await res.json();

  assert.equal(body.available, true);
  assert.ok(body.levels, "expected levels object on an available payload");
  assert.deepEqual(
    body.levels.nearestWall,
    { strike: 590, kind: "call", distancePts: 10 },
    "nearestWall must survive the resistance->call mapping, not come back null"
  );
});

test("mobile ticker route: put-wall-nearest (support) maps to kind 'put'", async () => {
  mockPositioning = {
    spot: 580,
    change_pct: -0.2,
    asof: "2026-10-26T14:30:00.000Z",
    flip: 575,
    call_wall: 610,
    put_wall: 576,
    max_pain: 578,
    gamma_posture: "short",
    gamma_regime_read: "Negative gamma",
    degraded: false,
    nearest_wall: { strike: 576, kind: "support", distance_pts: -4 },
  };

  const res = await GET(makeReq(), { params: Promise.resolve({ ticker: "SPY" }) });
  const body = await res.json();

  assert.deepEqual(body.levels.nearestWall, { strike: 576, kind: "put", distancePts: -4 });
});

test("mobile ticker route: no nearest wall (both walls absent) stays null, not a crash", async () => {
  mockPositioning = {
    spot: 580,
    change_pct: null,
    asof: "2026-10-26T14:30:00.000Z",
    flip: null,
    call_wall: null,
    put_wall: null,
    max_pain: null,
    gamma_posture: null,
    gamma_regime_read: "Neutral",
    degraded: false,
    nearest_wall: null,
  };

  const res = await GET(makeReq(), { params: Promise.resolve({ ticker: "SPY" }) });
  const body = await res.json();

  assert.equal(body.levels.nearestWall, null);
});
