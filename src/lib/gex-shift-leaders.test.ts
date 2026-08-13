import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickGexShiftLeaders, pickGexShiftLeaderCells, gexMatrixShiftCellKey, matrixShiftForLens, gateShiftOffHours, matrixShiftDeltaForStrike } from "./gex-shift-leaders";

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

  it("returns empty when shift has no delta map", () => {
    assert.deepEqual(pickGexShiftLeaders({}, { available: false }), []);
    assert.deepEqual(pickGexShiftLeaders({}, { available: true }), []);
  });

  it("returns leaders from delta map even when available is false (off-hours matrix DR%)", () => {
    const leaders = pickGexShiftLeaders(
      { "100": 1_000_000 },
      { available: false, delta_by_strike: { "100": 500_000 } },
    );
    assert.equal(leaders.length, 1);
    assert.equal(leaders[0]?.strike, 100);
  });

  it("gateShiftOffHours strips narrative but keeps delta_by_strike", () => {
    const gated = gateShiftOffHours({
      available: true,
      summary: "Over the last 2h: flip migrated",
      delta_by_strike: { "635": 250_000 },
      since_ms: 3_600_000,
      flip_migration: { from: 630, to: 635, delta_pts: 5 },
    });
    assert.equal(gated.available, false);
    assert.equal(gated.status, "collecting");
    assert.deepEqual(gated.delta_by_strike, { "635": 250_000 });
    assert.equal(gated.since_ms, 3_600_000);
    assert.equal((gated as { summary?: string }).summary, undefined);
  });

  it("matrixShiftDeltaForStrike reads deltas regardless of available", () => {
    assert.equal(
      matrixShiftDeltaForStrike({ available: false, delta_by_strike: { "640": -1200 } }, 640),
      -1200,
    );
    assert.equal(matrixShiftDeltaForStrike({ available: true }, 640), undefined);
  });

  it("matrixShiftForLens resolves per-lens shift blocks", () => {
    const payload = {
      shift: { available: true, delta_by_strike: { "100": 1 } },
      vex_shift: { available: true, delta_by_strike: { "200": 2 } },
      dex_shift: { available: true, delta_by_strike: { "300": 3 } },
      charm_shift: { available: true, delta_by_strike: { "400": 4 } },
    };
    assert.equal(matrixShiftForLens("gex", payload)?.delta_by_strike?.["100"], 1);
    assert.equal(matrixShiftForLens("vex", payload)?.delta_by_strike?.["200"], 2);
    assert.equal(matrixShiftForLens("dex", payload)?.delta_by_strike?.["300"], 3);
    assert.equal(matrixShiftForLens("charm", payload)?.delta_by_strike?.["400"], 4);
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
