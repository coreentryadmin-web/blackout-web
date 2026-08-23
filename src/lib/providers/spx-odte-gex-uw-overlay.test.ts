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

/**
 * `walls_by_horizon` — the DTE-scoped walls — must be recomputed by this overlay, not inherited.
 *
 * THE SETUP THAT MADE THIS NECESSARY. The field used to be assigned in exactly one place,
 * `prunePastExpiriesFromHeatmap`, which early-returns unchanged on a matrix with no past expiry
 * columns — i.e. on every fresh build. Measured on prod 2026-08-22 it was ABSENT on all six tickers
 * sampled. Populating it on the fresh build (the actual fix) immediately creates a second problem
 * here: this overlay REPLACES today's 0DTE column, so an inherited `walls_by_horizon` would carry
 * a PRE-overlay 0DTE wall beside a POST-overlay flip, wall pair and regime.
 *
 * That is the third instance of one failure mode in this single function — `regime` was left stale
 * once, `flip_reason` once — so it is asserted behaviourally rather than trusted.
 */
test("REGRESSION: the overlay recomputes walls_by_horizon from the OVERLAID 0DTE column", () => {
  const hm = baseHeatmap();
  // A stale horizon block, as if inherited from the pre-overlay book. The strikes are DELIBERATELY
  // ones the book cannot produce (9999 / 1000 are not on this chain at all): a recompute and an
  // inherit must be distinguishable, and picking a plausible strike makes them coincide. The first
  // draft of this test asserted `callWall !== 7800` and failed green-on-broken in reverse — 7800 IS
  // the correct post-overlay 0DTE call wall, so the assertion proved nothing either way.
  hm.gex.walls_by_horizon = [
    { label: "0DTE", maxDte: 0, expiries: [TODAY], callWall: 9999, putWall: 1000, callWallPts: 2263, putWallPts: -6736 },
  ];

  // The ladder inverts today's column: 7800 collapses to a token positive and 7650 becomes a large
  // NEGATIVE node. The sign matters — a wall is defined by the sign of net dealer gamma, not by
  // which side of spot it sits on, so a ladder of all-positive values has no put wall to find at
  // all. (The first draft of this test used +835m at 7650 and asserted a put wall there; it failed
  // correctly, and the code was right.)
  const ladder = new Map<number, number>([
    [7650, -835_268_500],
    [7800, 1],
  ]);
  const out = applySpxOdteGexUwOverlayWithLadder(hm, ladder, TODAY);

  const zero = out.gex.walls_by_horizon?.find((h) => h.label === "0DTE");
  assert.ok(zero, "the overlay must publish a 0DTE horizon, not drop the block");
  assert.deepEqual(zero.expiries, [TODAY], "the 0DTE bucket describes today's column only");
  assert.notEqual(zero.callWall, 9999, "the inherited 0DTE call wall must not survive the overlay");
  assert.notEqual(zero.putWall, 1000, "nor the inherited put wall");
  // What a real recompute over the OVERLAID column yields: 7800 carries +1, the only POSITIVE net
  // above spot 7736, so it is the 0DTE call wall; 7650 carries the ladder's -835,268,500, the only
  // NEGATIVE net below spot, so it is the 0DTE put wall.
  assert.equal(zero.callWall, 7800, "recomputed from the overlaid column, not inherited");
  assert.equal(zero.putWall, 7650, "the overlaid ladder's dominant sub-spot node is the 0DTE put wall");
  assert.equal(zero.callWallPts, Number((7800 - out.spot).toFixed(2)), "distances re-derive too");
});

test("the horizons the overlay publishes are side-constrained — the biggest negative is not automatically the put wall", () => {
  // The case that makes the constraint load-bearing: 7800 is MORE negative than 7650 but sits ABOVE
  // spot 7736. Unconstrained, argmax-negative picks 7800 and labels overhead resistance "support" —
  // the #2417 inversion. Constrained, the honest answer is 7650 for the put wall and NULL for the
  // call wall, because no positive-gamma strike sits above spot in this book at all.
  const hm = baseHeatmap();
  const out = applySpxOdteGexUwOverlayWithLadder(
    hm,
    new Map<number, number>([
      [7650, -835_268_500],
      [7800, -5e11],
    ]),
    TODAY
  );

  const zero = out.gex.walls_by_horizon?.find((h) => h.label === "0DTE");
  assert.equal(zero?.putWall, 7650, "the put wall is the biggest negative BELOW spot");
  assert.notEqual(zero?.putWall, 7800, "never the bigger negative sitting above spot");
  assert.equal(zero?.callWall, null, "no positive strike above spot means no call wall, not a fallback");

  // And the invariant across every bucket, so a future bucket added to wallsByHorizon inherits it.
  for (const h of out.gex.walls_by_horizon ?? []) {
    if (h.callWall != null) {
      assert.ok(h.callWall > out.spot, `${h.label} call wall ${h.callWall} must sit above spot ${out.spot}`);
    }
    if (h.putWall != null) {
      assert.ok(h.putWall < out.spot, `${h.label} put wall ${h.putWall} must sit below spot ${out.spot}`);
    }
  }
});

test("recomputeNearTermGexStrikeTotals honours a pinned session date for its DTE buckets", () => {
  // The buckets are DTE distances from a session, so the session must be the caller's, not the
  // wall clock — otherwise a date-pinned overlay and its own horizons describe different days.
  const hm = baseHeatmap();
  recomputeNearTermGexStrikeTotals(hm, TODAY);
  const zero = hm.gex.walls_by_horizon?.find((h) => h.label === "0DTE");
  assert.deepEqual(zero?.expiries, [TODAY]);
  const seven = hm.gex.walls_by_horizon?.find((h) => h.label === "7DTE");
  assert.deepEqual(seven?.expiries, [TODAY, "2026-08-08"], "7DTE is cumulative, so it includes today");
});
