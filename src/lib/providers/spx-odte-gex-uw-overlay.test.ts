import { test } from "node:test";
import assert from "node:assert/strict";
import type { GexHeatmap } from "./polygon-options-gex";
import {
  applySpxOdteGexUwOverlayWithLadder,
  recomputeNearTermGexStrikeTotals,
} from "./spx-odte-gex-uw-overlay";
import { odteGexScopeFromHeatmap, kingFromStrikeTotals } from "@/lib/correctness/gex-odte-scope";

const TODAY = "2026-08-05";

function baseHeatmap(): GexHeatmap {
  return {
    underlying: "SPX",
    spot: 7736,
    change_pct: 0.1,
    asof: "2026-08-05T14:00:00.000Z",
    expiries: [TODAY, "2026-08-08"],
    near_term_expiries: [TODAY, "2026-08-08"],
    strikes: [7800, 7700, 7650],
    max_pain: 7700,
    gex: {
      cells: {
        "7800": { [TODAY]: 9e11, "2026-08-08": 1e10 },
        "7700": { [TODAY]: 2e11, "2026-08-08": 5e9 },
        "7650": { [TODAY]: 1e11, "2026-08-08": 3e9 },
      },
      strike_totals: { "7800": 9.1e11, "7700": 2.05e11, "7650": 1.03e11 },
      call_wall: 7800,
      put_wall: 7650,
      total: 1.218e12,
      flip: 7720,
      regime: { flip: 7720, posture: "long", read: "test" },
    },
    vex: {
      cells: {},
      strike_totals: {},
      pos_wall: null,
      neg_wall: null,
      total: 0,
      flip: null,
      regime: { posture: null, read: "n/a" },
    },
    shift: { available: false, status: "collecting" },
    source: "polygon",
    data_delay: "15-min delayed",
  };
}

test("recomputeNearTermGexStrikeTotals sums near-term expiry columns only", () => {
  const hm = baseHeatmap();
  hm.gex.cells["7800"] = { [TODAY]: 100, "2026-08-08": 999 };
  recomputeNearTermGexStrikeTotals(hm);
  assert.equal(hm.gex.strike_totals["7800"], 100 + 999);
});

test("applySpxOdteGexUwOverlayWithLadder replaces 0DTE column so King matches UW oracle", () => {
  const hm = baseHeatmap();
  const before = odteGexScopeFromHeatmap(hm, TODAY);
  assert.equal(kingFromStrikeTotals(before.strikeTotals), 7800);

  const ladder = new Map<number, number>([
    [7650, 835_268_500],
    [7800, 200_000_100],
  ]);
  const out = applySpxOdteGexUwOverlayWithLadder(hm, ladder, TODAY);
  const after = odteGexScopeFromHeatmap(out, TODAY);
  assert.equal(kingFromStrikeTotals(after.strikeTotals), 7650);
  assert.equal(out.gex.cells["7650"]?.[TODAY], 835_268_500);
});

test("applySpxOdteGexUwOverlayWithLadder is a no-op for non-SPX tickers", () => {
  const hm = baseHeatmap();
  hm.underlying = "SPY";
  const ladder = new Map<number, number>([[7650, 1]]);
  const out = applySpxOdteGexUwOverlayWithLadder(hm, ladder, TODAY);
  assert.equal(out.gex.cells["7800"]?.[TODAY], hm.gex.cells["7800"]?.[TODAY]);
});
