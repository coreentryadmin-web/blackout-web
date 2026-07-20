import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickGexShiftLeaders, pickGexShiftLeaderCells, gexMatrixShiftCellKey } from "./gex-shift-leaders";

describe("pickGexShiftLeaders", () => {
  it("returns top 3 call + top 3 put by |delta|", () => {
    const shift = {
      available: true,
      delta_by_strike: {
        "100": 500_000,
        "105": 300_000,
        "110": 100_000,
        "95": -400_000,
        "90": -200_000,
        "85": -50_000,
      },
    };
    const totals = {
      "100": 1_000_000,
      "105": 800_000,
      "110": 600_000,
      "95": -900_000,
      "90": -700_000,
      "85": -600_000,
    };
    const leaders = pickGexShiftLeaders(totals, shift);
    assert.equal(leaders.filter((l) => l.side === "call").length, 3);
    assert.equal(leaders.filter((l) => l.side === "put").length, 3);
    assert.equal(leaders.find((l) => l.strike === 100)?.side, "call");
    assert.equal(leaders.find((l) => l.strike === 95)?.side, "put");
  });

  it("returns empty when shift unavailable", () => {
    assert.deepEqual(pickGexShiftLeaders({}, { available: false }), []);
  });

  it("pickGexShiftLeaderCells maps leaders to max-|cell| expiry column", () => {
    const shift = {
      available: true,
      delta_by_strike: { "5800": 200_000, "5700": -300_000 },
    };
    const totals = { "5800": 1_000_000, "5700": -800_000 };
    const cells = {
      "5800": { "2026-07-20": 100_000, "2026-07-21": 900_000 },
      "5700": { "2026-07-20": -50_000, "2026-07-21": -750_000 },
    };
    const map = pickGexShiftLeaderCells(totals, cells, ["2026-07-20", "2026-07-21"], shift, {
      perSide: 1,
    });
    assert.ok(map.get(gexMatrixShiftCellKey(5800, "2026-07-21")));
    assert.ok(map.get(gexMatrixShiftCellKey(5700, "2026-07-21")));
  });
});
