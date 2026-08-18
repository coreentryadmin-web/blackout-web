import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterLargeFlowPrints,
  capFlowMarkers,
  flowMarkerSize,
  flowMarkerText,
  buildFlowMarkers,
  FLOW_CALL_COLOR,
  FLOW_PUT_COLOR,
  DEFAULT_FLOW_MIN_PREMIUM,
  type FlowPrint,
} from "./vector-flow-markers";

function print(over: Partial<FlowPrint> = {}): FlowPrint {
  return { strike: 6750, side: "call", premium: 1_000_000, size: 100, tsMs: 1_700_000_000_000, ...over };
}

test("filterLargeFlowPrints: drops prints below the premium floor", () => {
  const prints = [
    print({ premium: 300_000 }),
    print({ premium: 100_000 }), // below floor → dropped
    print({ premium: 250_000 }), // exactly at floor → kept
  ];
  const out = filterLargeFlowPrints(prints, { minPremium: 250_000 });
  assert.equal(out.length, 2);
  assert.ok(out.every((p) => p.premium >= 250_000));
});

test("filterLargeFlowPrints: bands to spot when spot + bandPct given", () => {
  const spot = 6750;
  const prints = [
    print({ strike: 6760 }), // within 5% → kept
    print({ strike: 7200 }), // ~6.7% away → dropped
    print({ strike: 6400 }), // ~5.2% away → dropped
  ];
  const out = filterLargeFlowPrints(prints, { minPremium: 250_000, spot, bandPct: 0.05 });
  assert.deepEqual(
    out.map((p) => p.strike),
    [6760]
  );
});

test("filterLargeFlowPrints: rejects malformed premium/strike (no NaN leaks)", () => {
  const prints = [
    print({ premium: Number.NaN }),
    print({ strike: 0 }),
    print({ strike: Number.NaN }),
    print({ premium: 500_000, strike: 6750 }), // the only valid one
  ];
  const out = filterLargeFlowPrints(prints, { minPremium: 250_000 });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.strike, 6750);
});

test("capFlowMarkers: keeps top-N by premium and reports the truncation", () => {
  const prints = [
    print({ premium: 1_000_000 }),
    print({ premium: 5_000_000 }),
    print({ premium: 2_000_000 }),
    print({ premium: 800_000 }),
  ];
  const { shown, truncated } = capFlowMarkers(prints, 2);
  assert.equal(truncated, 2);
  assert.deepEqual(
    shown.map((p) => p.premium),
    [5_000_000, 2_000_000] // largest first
  );
});

test("capFlowMarkers: maxN ≤ 0 means no cap; sorted desc, truncated 0", () => {
  const prints = [print({ premium: 300_000 }), print({ premium: 900_000 })];
  const { shown, truncated } = capFlowMarkers(prints, 0);
  assert.equal(truncated, 0);
  assert.deepEqual(
    shown.map((p) => p.premium),
    [900_000, 300_000]
  );
});

test("flowMarkerSize: monotone in premium, floored at 1, clamped at 2.4", () => {
  const floor = DEFAULT_FLOW_MIN_PREMIUM;
  assert.equal(flowMarkerSize(floor, floor), 1); // at floor → base size
  const s10x = flowMarkerSize(floor * 10, floor);
  const s100x = flowMarkerSize(floor * 100, floor);
  assert.ok(s10x > 1 && s10x < s100x); // bigger premium → bigger marker
  assert.ok(flowMarkerSize(floor * 100_000, floor) <= 2.4); // clamp holds for a whale print
});

test("flowMarkerText: side initial + compact premium", () => {
  assert.equal(flowMarkerText(print({ side: "call", premium: 1_200_000 })), "C $1.2M");
  assert.equal(flowMarkerText(print({ side: "put", premium: 780_000 })), "P $780K");
});

test("buildFlowMarkers: calls green ↑ / puts red ↓, at strike, ascending by time (seconds)", () => {
  const prints = [
    print({ side: "put", strike: 6700, premium: 900_000, tsMs: 1_700_000_020_000 }),
    print({ side: "call", strike: 6800, premium: 1_500_000, tsMs: 1_700_000_010_000 }),
  ];
  const markers = buildFlowMarkers(prints, DEFAULT_FLOW_MIN_PREMIUM);
  // ascending by time even though the call was passed second
  assert.deepEqual(
    markers.map((m) => m.time),
    [1_700_000_010, 1_700_000_020]
  );
  const call = markers.find((m) => m.price === 6800)!;
  const put = markers.find((m) => m.price === 6700)!;
  assert.equal(call.color, FLOW_CALL_COLOR);
  assert.equal(call.shape, "arrowUp");
  assert.equal(call.position, "atPriceMiddle");
  assert.equal(put.color, FLOW_PUT_COLOR);
  assert.equal(put.shape, "arrowDown");
});

// ── THE FLOOR, PINNED TO A MEASUREMENT (2026-08-18) ──────────────────────────────────────────
// DEFAULT_FLOW_MIN_PREMIUM was $250,000 — a correct "large" cutoff for AGGREGATE flow, applied to
// a SINGLE print. Measured live on SPY 0DTE (8 near-ATM contracts, 60-minute RTH window, straight
// off Polygon): n=1210, p50 $348, p90 $2,380, p99 $10,452, max $37,410, and ZERO prints at or above
// $250K. The overlay returned largeFound:0 on every successful call. These assertions exist so the
// number cannot drift back to one nobody measured.
const SPY_0DTE_MEASURED = { p50: 348, p90: 2_380, p99: 10_452, max: 37_410 };

test("the large-print floor sits inside the measured single-print distribution", () => {
  assert.ok(
    DEFAULT_FLOW_MIN_PREMIUM > SPY_0DTE_MEASURED.p90,
    "floor must exclude ordinary retail lots (above the measured p90)"
  );
  assert.ok(
    DEFAULT_FLOW_MIN_PREMIUM < SPY_0DTE_MEASURED.p99,
    "floor must sit BELOW the p99 — above it, a busy 0DTE chain yields an empty overlay"
  );
  assert.ok(
    DEFAULT_FLOW_MIN_PREMIUM < SPY_0DTE_MEASURED.max,
    "a floor above the largest print ever observed cannot match anything"
  );
});

test("real measured prints survive the filter — the regression this replaces", () => {
  // Premiums drawn from the measured distribution's upper tail. Under the old $250K floor EVERY
  // one of these was discarded and the chart drew nothing.
  const prints = [37_410, 32_319, 27_060, 18_522, 10_452, 2_380, 348].map((premium, i) => ({
    strike: 767,
    side: "call" as const,
    premium,
    size: 10,
    tsMs: 1_000 + i,
    aggressor: null,
  }));
  const kept = filterLargeFlowPrints(prints, { minPremium: DEFAULT_FLOW_MIN_PREMIUM });
  assert.equal(kept.length, 5, "the five prints above the floor become markers");
  assert.ok(kept.every((p) => p.premium >= DEFAULT_FLOW_MIN_PREMIUM));
});

test("marker size varies across the measured range instead of pinning to one end", () => {
  // The [floor, 50x floor] ramp has to span premiums that actually occur, or every marker is the
  // same size — which is indistinguishable from a broken size function.
  const sizes = [5_000, 10_452, 18_522, 37_410].map((p) => flowMarkerSize(p, DEFAULT_FLOW_MIN_PREMIUM));
  assert.equal(new Set(sizes).size, sizes.length, "each measured premium maps to a distinct size");
  for (let i = 1; i < sizes.length; i++) {
    assert.ok(sizes[i]! > sizes[i - 1]!, "size must increase monotonically with premium");
  }
});
