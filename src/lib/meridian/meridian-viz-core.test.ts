import { test } from "node:test";
import assert from "node:assert/strict";
import {
  num,
  priceDomain,
  pctAlong,
  normalizeMoveBand,
  haloFromSignals,
  arcPath,
  beatSeries,
  beatTally,
  revisionMomentum,
  targetRail,
  structureLadder,
  darkPoolTape,
  countdownTo,
  sparklinePoints,
  momentumSignal,
  anomalySignal,
  dimensionRollup,
  etWallClockToIso,
  resolveCollisions,
} from "./meridian-viz-core";

// ── null propagation. The repo's recurring defect is Number(null) === 0; on a price rail a
// coerced zero does not mislabel one marker, it drags the domain to the origin and squashes
// every real level into the right edge.
test("num: absent values stay absent — they never become 0", () => {
  assert.equal(num(null), null);
  assert.equal(num(undefined), null);
  assert.equal(num(NaN), null);
  assert.equal(num(Infinity), null);
  assert.equal(num(""), null, "empty string must not read as 0");
  assert.equal(num(0), 0, "a real zero survives");
  assert.equal(num("12.5"), 12.5);
});

test("priceDomain: covers every marker it is given", () => {
  // Band 95-105 but a call wall at 130 — the domain must reach it.
  const d = priceDomain([100, 95, 105, 130]);
  assert.ok(d);
  assert.ok(d!.min < 95 && d!.max > 130, "padded beyond the extremes");
  const wall = pctAlong(130, d);
  assert.ok(wall !== null && wall < 1, "the outermost marker sits INSIDE the rail, not pinned at 1");
});

test("priceDomain: a marker outside the domain would pin, not vanish — the reason to pass them all", () => {
  const narrow = priceDomain([95, 105]); // call wall omitted
  assert.equal(pctAlong(130, narrow), 1, "clamped to the end — reads as 'wall is at the boundary'");
});

test("priceDomain: nulls are ignored, not treated as zero", () => {
  const d = priceDomain([100, null, 110, undefined]);
  assert.ok(d && d.min > 50, `a null must not drag the floor to 0 (got ${d?.min})`);
});

test("priceDomain: no finite values → null (never a fabricated scale)", () => {
  assert.equal(priceDomain([null, undefined, NaN]), null);
});

test("pctAlong: null in, null out; midpoint is 0.5", () => {
  const d = priceDomain([0, 100], 0);
  assert.equal(pctAlong(50, d), 0.5);
  assert.equal(pctAlong(null, d), null);
  assert.equal(pctAlong(50, null), null);
});

// ── expected move
test("normalizeMoveBand: reconstructs bounds from a percentage when only that is served", () => {
  const b = normalizeMoveBand({ spot: 100 }, 10);
  assert.ok(b);
  assert.equal(b!.up, 110);
  assert.equal(b!.down, 90);
});

test("normalizeMoveBand: an inverted band is repaired, not rendered as negative width", () => {
  const b = normalizeMoveBand({ spot: 100, up: 90, down: 110 });
  assert.equal(b!.up, 110);
  assert.equal(b!.down, 90);
});

test("normalizeMoveBand: no spot → null (a move band without a centre is meaningless)", () => {
  assert.equal(normalizeMoveBand({ up: 110, down: 90 }), null);
  assert.equal(normalizeMoveBand({ spot: 0, up: 110, down: 90 }), null);
});

// ── halo. The agreement measure is the whole reason this is a halo and not a number.
test("haloFromSignals: unanimous signals score agreement 1", () => {
  const h = haloFromSignals([
    { lean: "bullish", weight: 2 },
    { lean: "bullish", weight: 3 },
  ]);
  assert.equal(h!.agreement, 1);
  assert.equal(h!.dominant, "bullish");
});

test("haloFromSignals: a split book scores agreement 0 — same verdict, different setup", () => {
  const h = haloFromSignals([
    { lean: "bullish", weight: 5 },
    { lean: "bearish", weight: 5 },
  ]);
  assert.equal(h!.agreement, 0, "balanced conflict must read as zero conviction");
});

test("haloFromSignals: negative weights are magnitudes — lean already carries direction", () => {
  const h = haloFromSignals([{ lean: "bearish", weight: -4 }]);
  assert.equal(h!.bearWeight, 4, "a negative weight must not shrink or invert the ring");
  assert.equal(h!.totalWeight, 4);
});

test("haloFromSignals: unweighted signals still occupy the ring", () => {
  const h = haloFromSignals([{ lean: "bullish" }, { lean: "bearish", weight: null }]);
  assert.equal(h!.totalWeight, 2, "dropping them would under-represent the evidence");
});

test("haloFromSignals: an all-neutral book agrees on nothing (not perfectly)", () => {
  const h = haloFromSignals([{ lean: "neutral", weight: 3 }]);
  assert.equal(h!.agreement, 0);
  assert.equal(h!.dominant, "neutral");
});

test("haloFromSignals: segments always sum to the full ring", () => {
  const h = haloFromSignals([
    { lean: "bullish", weight: 1 },
    { lean: "bearish", weight: 2 },
    { lean: "neutral", weight: 3 },
  ]);
  const sum = h!.segments.reduce((a, s) => a + s.fraction, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `segments must tile the ring, summed ${sum}`);
});

test("haloFromSignals: empty → null (no ring rather than an empty one)", () => {
  assert.equal(haloFromSignals([]), null);
  assert.equal(haloFromSignals(null), null);
});

test("arcPath: a full ring does not collapse to a degenerate point", () => {
  const full = arcPath(50, 50, 40, 0, 360);
  assert.ok(full.includes("A 40 40"), "renders as an arc");
  const [, x1, y1] = /A 40 40 0 \d 1 ([\d.]+) ([\d.]+)/.exec(full) ?? [];
  assert.ok(x1 && y1, "has an explicit endpoint");
  assert.notEqual(`${x1},${y1}`, "50.000,10.000", "endpoint must not equal the start point");
});

// ── beat history
const PRINTS = [
  { report_date: "2026-05-15", surprise_pct: 11.4, beat: true, session_change_pct: -2.28, reaction_basis: "amc_next_session" },
  { report_date: "2026-03-18", surprise_pct: 56.8, beat: true, session_change_pct: 1.36, reaction_basis: "assumed_report_session" },
  { report_date: "2025-11-17", surprise_pct: -5, beat: false, session_change_pct: 3.01, reaction_basis: "amc_next_session" },
  { report_date: "2025-08-20", surprise_pct: null, beat: null, session_change_pct: null, reaction_basis: null },
];

test("beatSeries: magnitude is relative to the series peak, so no quarter is invisible", () => {
  const s = beatSeries(PRINTS);
  assert.equal(s[1]!.magnitude, 1, "the 56.8% outlier is the peak");
  assert.ok(s[0]!.magnitude > 0.15, `the 11.4% quarter must stay visible, got ${s[0]!.magnitude}`);
  assert.equal(s[3]!.magnitude, 0, "no surprise → no bar, not a zero-height claim");
});

test("beatSeries: surfaces an ASSUMED reaction so the UI can mark it", () => {
  const s = beatSeries(PRINTS);
  assert.equal(s[1]!.reactionAssumed, true);
  assert.equal(s[0]!.reactionAssumed, false);
});

test("beatTally: ungraded prints are excluded, never counted as misses", () => {
  const t = beatTally(beatSeries(PRINTS));
  assert.equal(t.graded, 3, "the null-surprise print is not graded");
  assert.equal(t.beats, 2);
});

// ── revisions
test("revisionMomentum: initiations count toward total but take no side", () => {
  const m = revisionMomentum({ raised_count: 6, lowered_count: 1, initiated_count: 3 });
  assert.equal(m!.total, 10);
  assert.equal(m!.tilt, 0.7143, "tilt is over the 7 directional revisions, not all 10");
});

test("revisionMomentum: the server's own skew label wins over a derived one", () => {
  // Derived tilt here is bullish; the server said neutral. The chip must not contradict the
  // sentence rendered beside it.
  const m = revisionMomentum({ raised_count: 5, lowered_count: 1, initiated_count: 0, skew: "neutral" });
  assert.equal(m!.skew, "neutral");
});

test("revisionMomentum: no revisions → null", () => {
  assert.equal(revisionMomentum({ raised_count: 0, lowered_count: 0, initiated_count: 0 }), null);
  assert.equal(revisionMomentum(null), null);
});

// ── target rail
test("targetRail: consensus is the MEDIAN — one outlier must not drag it off the cluster", () => {
  const r = targetRail([{ price_target: 12 }, { price_target: 13 }, { price_target: 15 }, { price_target: 40 }], 10);
  assert.equal(r!.consensus, 14, "median of 12,13,15,40; the mean would be 20");
  assert.equal(r!.low, 12);
  assert.equal(r!.high, 40);
});

test("targetRail: upside is measured from spot, and absent without one", () => {
  assert.equal(targetRail([{ price_target: 12 }, { price_target: 16 }], 10)!.upsidePct, 40);
  assert.equal(targetRail([{ price_target: 12 }], null)!.upsidePct, null);
});

test("targetRail: non-positive and missing targets are dropped", () => {
  assert.equal(targetRail([{ price_target: 0 }, { price_target: null }]), null);
});

// ── structure ladder. Spatial truth is the point.
test("structureLadder: orders by PRICE, not by narrative", () => {
  // An INVERTED book: spot ABOVE the call wall — the regime a trader most needs to see.
  const l = structureLadder({ spot: 120, call_wall: 110, put_wall: 90, flip: 100, gex_king_strike: 105 });
  assert.deepEqual(
    l.map((x) => x.key),
    ["spot", "call_wall", "king_node", "gamma_flip", "put_wall"],
    "spot sits on top because the price says so"
  );
});

test("structureLadder: distances are signed from spot", () => {
  const l = structureLadder({ spot: 100, call_wall: 110, put_wall: 90 });
  assert.equal(l.find((x) => x.key === "call_wall")!.distPct, 10);
  assert.equal(l.find((x) => x.key === "put_wall")!.distPct, -10);
});

test("structureLadder: missing levels are omitted, not drawn at zero", () => {
  const l = structureLadder({ spot: 100, call_wall: null, flip: undefined });
  assert.deepEqual(l.map((x) => x.key), ["spot"]);
});

// ── dark pool
test("darkPoolTape: magnitude is area-proportional (sqrt), not diameter-proportional", () => {
  const t = darkPoolTape([{ premium: 100 }, { premium: 25 }]);
  assert.equal(t[0]!.magnitude, 1);
  // 25/100 = 0.25 linear would look 16x smaller by area; sqrt gives 0.5, i.e. 4x by area.
  assert.equal(t[1]!.magnitude, 0.5);
});

test("darkPoolTape: sorted largest-first, non-positive dropped", () => {
  const t = darkPoolTape([{ premium: 10 }, { premium: 500 }, { premium: 0 }, { premium: null }]);
  assert.equal(t.length, 2);
  assert.equal(t[0]!.premium, 500);
});

// ── countdown
test("countdownTo: splits a span and reports a past event as past", () => {
  const now = Date.parse("2026-08-18T00:00:00Z");
  const c = countdownTo("2026-08-19T21:43:00Z", now);
  assert.equal(c!.days, 1);
  assert.equal(c!.hours, 21);
  assert.equal(c!.minutes, 43);
  assert.equal(c!.past, false);
  const done = countdownTo("2026-08-17T00:00:00Z", now);
  assert.equal(done!.past, true, "must say 'past', not freeze at 00D:00H:00M as if imminent");
});

test("countdownTo: unparseable input → null", () => {
  assert.equal(countdownTo("not-a-date", Date.now()), null);
  assert.equal(countdownTo(null, Date.now()), null);
});

// ── sparkline
test("sparklinePoints: needs two points; one is not a trend", () => {
  assert.equal(sparklinePoints([5], 100, 20), null);
  assert.ok(sparklinePoints([1, 2, 3], 100, 20));
});

test("sparklinePoints: gaps break the line rather than inventing a value", () => {
  const pts = sparklinePoints([1, null, 3], 100, 20);
  assert.equal(pts!.split(" ").length, 2, "the null contributes no vertex");
});

test("sparklinePoints: a flat series renders mid-box, not divided by zero", () => {
  const pts = sparklinePoints([7, 7, 7], 100, 20);
  assert.ok(pts && !pts.includes("NaN"));
});

// ── live signals
test("momentumSignal: fires only past the threshold, so the chip keeps meaning", () => {
  assert.equal(momentumSignal(103, 100, 5), null, "a 3% move is noise");
  assert.equal(momentumSignal(110, 100, 5), "accelerating");
  assert.equal(momentumSignal(90, 100, 5), "deteriorating");
  assert.equal(momentumSignal(110, null), null, "no prior → no claim");
  assert.equal(momentumSignal(110, 0), null, "no division by a zero base");
});

test("anomalySignal: demands a real sample before calling anything anomalous", () => {
  assert.equal(anomalySignal(100, [1, 2, 3], 2), null, "3 points is not a distribution");
  assert.equal(anomalySignal(100, [1, 2, 3, 2, 1], 2), "anomaly");
  assert.equal(anomalySignal(2, [1, 2, 3, 2, 1], 2), null);
  assert.equal(anomalySignal(5, [2, 2, 2, 2], 2), null, "zero variance → no anomaly, no divide-by-zero");
});

// ── dimension rollup
const SIGS = [
  { pillar: "flow", lean: "bullish", weight: 3 },
  { pillar: "dark_pool", lean: "bullish", weight: 2 },
  { pillar: "thermal", lean: "bearish", weight: 2 },
  { pillar: "vector", lean: "bullish", weight: 2 },
  { pillar: "analyst", lean: "bearish", weight: 4 },
  { pillar: "history", lean: "bullish", weight: 1 },
  { pillar: "surprise", lean: "bullish", weight: 1 },
];

test("dimensionRollup: 11 pillars collapse to the five dimensions a trader reasons in", () => {
  const d = dimensionRollup(SIGS);
  assert.deepEqual(d.map((x) => x.dimension), ["FLOW", "STRUCTURE", "SENTIMENT", "HISTORY"]);
  assert.equal(d.find((x) => x.dimension === "FLOW")!.contributing, 2, "flow + dark_pool");
});

test("dimensionRollup: internal disagreement lowers intensity — it must not cancel to a confident zero", () => {
  const d = dimensionRollup(SIGS);
  const structure = d.find((x) => x.dimension === "STRUCTURE")!;
  // thermal bearish 2 vs vector bullish 2 -> net 0 of total 4.
  assert.equal(structure.net, 0);
  assert.equal(structure.intensity, 0);
  assert.equal(structure.lean, "neutral", "a fighting dimension reads neutral, not falsely certain");
  // And a UNANIMOUS dimension of the same total weight reads maximal — the contrast is the point.
  const flow = d.find((x) => x.dimension === "FLOW")!;
  assert.equal(flow.intensity, 100);
});

test("dimensionRollup: dimensions with no pillars are omitted, never drawn empty", () => {
  const d = dimensionRollup([{ pillar: "flow", lean: "bullish", weight: 1 }]);
  assert.deepEqual(d.map((x) => x.dimension), ["FLOW"]);
});

test("dimensionRollup: unknown pillars are ignored rather than silently bucketed", () => {
  const d = dimensionRollup([{ pillar: "made_up", lean: "bullish", weight: 9 }]);
  assert.deepEqual(d, []);
});

test("dimensionRollup: neutral pillars add weight without direction", () => {
  const d = dimensionRollup([
    { pillar: "flow", lean: "bullish", weight: 1 },
    { pillar: "dark_pool", lean: "neutral", weight: 3 },
  ]);
  const flow = d[0]!;
  assert.equal(flow.net, 1);
  assert.equal(flow.intensity, 25, "1 of 4 total weight — neutral dilutes conviction");
});

// ── ET wall clock → UTC. A hardcoded offset is wrong for half the year.
test("etWallClockToIso: EDT (summer) resolves at UTC-4", () => {
  assert.equal(etWallClockToIso("2026-08-19", "16:15:00"), "2026-08-19T20:15:00.000Z");
});

test("etWallClockToIso: EST (winter) resolves at UTC-5 — the same code, a different offset", () => {
  assert.equal(etWallClockToIso("2026-01-14", "16:15:00"), "2026-01-14T21:15:00.000Z");
});

test("etWallClockToIso: a pre-open time resolves on the same ET date", () => {
  assert.equal(etWallClockToIso("2026-08-19", "06:30:00"), "2026-08-19T10:30:00.000Z");
});

test("etWallClockToIso: missing time defaults to ET midnight, not UTC midnight", () => {
  assert.equal(etWallClockToIso("2026-08-19", null), "2026-08-19T04:00:00.000Z");
});

test("etWallClockToIso: malformed input → null rather than a plausible wrong instant", () => {
  assert.equal(etWallClockToIso("19-08-2026", "16:15"), null);
  assert.equal(etWallClockToIso(null, "16:15"), null);
  assert.equal(etWallClockToIso("2026-08-19", "99:99"), null);
});

// ── collision resolution. Measured defect: king node 780 and max pain 775 rendered 7px apart
// in a 132px ladder with ~14px rows, so the two labels printed on top of each other.
test("resolveCollisions: separates crowded labels to at least the minimum gap", () => {
  const out = resolveCollisions([0.5, 0.52], 0.1);
  assert.ok(out[1]! - out[0]! >= 0.0999, `expected >=0.1 gap, got ${out[1]! - out[0]!}`);
});

test("resolveCollisions: ORDER is preserved — a resolver that re-sorts destroys spatial truth", () => {
  const input = [0.9, 0.1, 0.5, 0.52];
  const out = resolveCollisions(input, 0.12);
  // Ranks by value must match ranks by resolved position.
  const rankIn = input.map((v) => input.filter((x) => x < v).length);
  const rankOut = out.map((v) => out.filter((x) => x < v).length);
  assert.deepEqual(rankOut, rankIn);
});

test("resolveCollisions: a stack pushed past the top is pulled back inside bounds", () => {
  const out = resolveCollisions([0.95, 0.96, 0.97], 0.1);
  assert.ok(Math.max(...out) <= 1, "nothing escapes the track");
  assert.ok(Math.min(...out) >= 0);
  assert.ok(out[1]! - out[0]! >= 0.0999 && out[2]! - out[1]! >= 0.0999, "gaps survive the pull-back");
});

test("resolveCollisions: when they cannot all fit, they spread evenly rather than pile up", () => {
  const out = resolveCollisions([0.5, 0.5, 0.5, 0.5, 0.5], 0.4); // 4*0.4 > 1
  assert.deepEqual(out.map((v) => Math.round(v * 100) / 100), [0, 0.25, 0.5, 0.75, 1]);
});

test("resolveCollisions: already-separated positions are left alone", () => {
  const input = [0.1, 0.5, 0.9];
  assert.deepEqual(resolveCollisions(input, 0.05), input);
});

test("resolveCollisions: degenerate inputs", () => {
  assert.deepEqual(resolveCollisions([], 0.1), []);
  assert.deepEqual(resolveCollisions([0.4], 0.1), [0.4]);
});
