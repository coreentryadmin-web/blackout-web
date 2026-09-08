import { test } from "node:test";
import assert from "node:assert/strict";
import { perExpiryWallsFromContracts } from "./vector-dte-walls-core";
import type { ReconstructContract } from "./vector-gex-reconstruct";

const TODAY = "2026-07-10";

// Regression for the 2026-09-04 audit finding: perExpiryWallsFromContracts feeds the Vector
// chart's own DTE-toggle wall overlay (GET /api/market/vector/walls) and used to call
// computeGexWalls with no spot argument, so a call wall could serve BELOW spot (or a put wall
// ABOVE it) — reproduced live on IBIT (call wall 46 vs spot 46.06) across every DTE horizon.
test("perExpiryWallsFromContracts: call/put walls never land on the wrong side of spot", () => {
  const spot = 7580;
  const contracts: ReconstructContract[] = [
    // Below spot, disproportionate OI — outweighs the honest above-spot wall on raw |gamma|.
    { strike: 7500, expiry: TODAY, openInterest: 100000, iv: 0.15, type: "call" },
    // Above spot, modest OI — the honest call wall.
    { strike: 7620, expiry: TODAY, openInterest: 5000, iv: 0.15, type: "call" },
    { strike: 7450, expiry: TODAY, openInterest: 9000, iv: 0.15, type: "put" },
  ];
  const result = perExpiryWallsFromContracts(contracts, spot, "0dte", TODAY);
  assert.ok(result, "must produce a wall set for a valid same-day expiry");
  assert.equal(
    result!.walls.callWalls[0]?.strike,
    7620,
    "call wall must be the honest above-spot strike, not the below-spot one"
  );
  assert.ok(
    result!.walls.callWalls.every((w) => w.strike > spot),
    "no callWalls entry may sit at/below spot"
  );
  assert.ok(
    result!.walls.putWalls.every((w) => w.strike < spot),
    "no putWalls entry may sit at/above spot"
  );
});
