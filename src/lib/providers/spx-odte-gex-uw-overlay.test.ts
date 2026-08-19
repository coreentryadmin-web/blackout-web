import { test } from "node:test";
import assert from "node:assert/strict";
import type { GexHeatmap } from "./polygon-options-gex";
import {
  applySpxOdteGexUwOverlayWithLadder,
  recomputeNearTermGexStrikeTotals,
} from "./spx-odte-gex-uw-overlay";
import {
  odteGexScopeFromHeatmap,
  kingFromStrikeTotals,
  resolveOdteExpiry,
} from "@/lib/correctness/gex-odte-scope";

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

/**
 * Two resolvers, deliberately different — and this test used to conflate them.
 *
 * `resolveOdteExpiry` (non-strict) falls back to the FRONT expiry when today's column is gone;
 * that is what the live overlay caller uses to decide which column to WRITE (#2365).
 * `resolveZeroDteExpiry` (strict, behind `odteGexScopeFromHeatmap`) refuses that fallback,
 * because comparing the UW 0DTE oracle against the NEXT expiry's column false-flagged net-GEX
 * sign (#2366 / ops-auto-fix #2360).
 *
 * Both are correct for their own job. The original assertion verified the non-strict WRITE by
 * asking the STRICT reader — and, worse, asked it for `2026-08-19` when the overlay had written
 * to `2026-08-20`. It passed only while the strict reader still had a fallback, and #2366 removed
 * it. Neither PR was wrong; each was green on its own branch and they were red only once merged
 * together, so `main` broke without any individual check ever failing.
 *
 * So this now asserts the actual contract: the CALLER resolves the front expiry, the overlay
 * writes there, and the strict reader still refuses to answer for an off-axis date.
 */
test("applySpxOdteGexUwOverlayWithLadder writes to the caller-resolved front expiry when today is off-axis", () => {
  const TODAY_OFF_AXIS = "2026-08-19";
  const FRONT = "2026-08-20";
  const hm = baseHeatmap();
  hm.expiries = [FRONT, "2026-08-21"];
  hm.near_term_expiries = [FRONT, "2026-08-21"];
  hm.gex.cells = {
    "7800": { [FRONT]: 9e11 },
    "7700": { [FRONT]: 2e11 },
    "7650": { [FRONT]: 1e11 },
  };

  const ladder = new Map<number, number>([
    [7650, 835_268_500],
    [7800, 200_000_100],
  ]);

  // Exactly what applySpxOdteGexUwOverlay does before delegating here.
  const resolved = resolveOdteExpiry(hm.expiries, TODAY_OFF_AXIS);
  assert.equal(resolved, FRONT, "the non-strict resolver is what picks the front column");

  const out = applySpxOdteGexUwOverlayWithLadder(hm, ladder, resolved!);

  // The write landed in the front column — asserted on the cells themselves, so this no longer
  // depends on any reader's fallback policy.
  assert.equal(out.gex.cells["7650"]?.[FRONT], 835_268_500);
  assert.equal(out.gex.cells["7800"]?.[FRONT], 200_000_100);

  // Read back at the expiry the overlay actually wrote to.
  const scope = odteGexScopeFromHeatmap(out, FRONT);
  assert.equal(scope.expiry, FRONT);
  assert.equal(kingFromStrikeTotals(scope.strikeTotals), 7650);
});

test("the strict 0DTE reader still refuses an off-axis today — the two resolvers must not re-converge", () => {
  // The guard for the collision above. If someone restores a front-expiry fallback inside the
  // strict reader to make an overlay test pass, the UW net-GEX oracle silently starts comparing
  // against the wrong expiry column again — the exact false-flag #2366 was written to stop.
  const hm = baseHeatmap();
  hm.expiries = ["2026-08-20", "2026-08-21"];
  hm.near_term_expiries = ["2026-08-20", "2026-08-21"];

  const strict = odteGexScopeFromHeatmap(hm, "2026-08-19");
  assert.equal(strict.expiry, null, "strict scope must NOT fall back to the front expiry");
  assert.deepEqual(strict.strikeTotals, {});
  assert.equal(strict.total, 0);

  // ...while the non-strict resolver, which the overlay caller uses, still does fall back.
  assert.equal(resolveOdteExpiry(hm.expiries, "2026-08-19"), "2026-08-20");
});
