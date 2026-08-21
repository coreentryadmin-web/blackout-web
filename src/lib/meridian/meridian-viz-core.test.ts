import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  layoutRailLabels,
  detailRefreshMsFor,
  hoursUntilIso,
  estimateTrajectory,
  estimateDispersion,
  strikeProfile,
  impliedVsRealized,
  MV_LADDER_MIN_GAP,
  MV_LADDER_ROW_PX,
  MV_LADDER_HEIGHT_PX,
  MV_RAIL_LABEL_FONT_PX,
  MV_RAIL_LABEL_LETTER_SPACING_EM,
  MV_RAIL_LABEL_LIFT_PX,
  MV_RAIL_LABEL_SLACK_PX,
  railLabelWidthPx,
  MV_RAIL_TIER_PX,
  MV_RAIL_LABEL_PX,
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

// ── estimate trajectory
test("estimateTrajectory: estimate and actual share ONE scale — otherwise a miss looks like a beat", () => {
  const t = estimateTrajectory([
    { period: "Q1", estimate: 1, actual: 0.5 },   // a big miss
    { period: "Q2", estimate: 2, actual: 2.2 },
  ]);
  // Q1's actual must be visibly SHORTER than its estimate. Per-series scaling would have made
  // Q2's actual the max of the actual series and Q1's the max of the estimate series, so the
  // two bars in Q1 would have looked comparable.
  assert.ok(t[0]!.actHeight! < t[0]!.estHeight!, "the miss must read as shorter");
  assert.ok(t[1]!.actHeight! > t[1]!.estHeight!, "and the beat as taller");
});

test("estimateTrajectory: an all-negative series uses the full track, not the first 6% of it", () => {
  // Measured defect: 0-anchoring a loss-making name crushed the estimate outline to ~6% width.
  const t = estimateTrajectory([
    { period: "Q1", estimate: -0.17, actual: -0.13 },
    { period: "Q2", estimate: -0.18, actual: null },
  ]);
  assert.ok(t[0]!.actHeight! > t[0]!.estHeight!, "-0.13 beats -0.17 and must be the longer bar");
  assert.ok(t[0]!.actHeight! > 0.5, `the comparison must use the track, got ${t[0]!.actHeight}`);
  assert.ok(t[0]!.estHeight! >= 0, "no negative bar lengths");
});

test("estimateTrajectory: a series that CROSSES zero keeps zero anchored so the sign shows", () => {
  const t = estimateTrajectory([
    { period: "Q1", estimate: -1, actual: -0.5 },
    { period: "Q2", estimate: 0.5, actual: 1 },
  ]);
  // With zero inside the domain, a loss sits in the lower half and a profit in the upper.
  assert.ok(t[0]!.actHeight! < 0.5, "the negative quarter stays below the midpoint");
  assert.ok(t[1]!.actHeight! > 0.5, "and the positive quarter above it");
});

test("estimateTrajectory: a forward period is flagged, not treated as a zero actual", () => {
  const t = estimateTrajectory([{ period: "Q3", estimate: 1.2, actual: null }]);
  assert.equal(t[0]!.forward, true);
  assert.equal(t[0]!.actHeight, null, "no bar for an actual that does not exist yet");
  assert.equal(t[0]!.surprisePct, null);
});

test("estimateTrajectory: surprise against a zero estimate is undefined, not Infinity", () => {
  const t = estimateTrajectory([{ period: "Q1", estimate: 0, actual: 0.5 }]);
  assert.equal(t[0]!.surprisePct, null);
});

test("estimateTrajectory: empty in, empty out", () => {
  assert.deepEqual(estimateTrajectory([]), []);
  assert.deepEqual(estimateTrajectory(null), []);
});

// ── dispersion
test("estimateDispersion: reports the spread the consensus hides", () => {
  const d = estimateDispersion([1.0, 1.2, 1.1, 2.0])!;
  assert.equal(d.low, 1.0);
  assert.equal(d.high, 2.0);
  assert.equal(d.median, 1.15);
  assert.ok(d.spreadPct! > 80, "a 1.0-2.0 range around a 1.15 median is a wide disagreement");
  assert.equal(d.n, 4);
});

test("estimateDispersion: spread is relative — an absolute one is meaningless across names", () => {
  const small = estimateDispersion([1, 2])!;
  const large = estimateDispersion([100, 200])!;
  assert.equal(small.spreadPct, large.spreadPct, "same proportional disagreement, same number");
});

test("estimateDispersion: a zero median yields null spread rather than Infinity", () => {
  assert.equal(estimateDispersion([-1, 1])!.spreadPct, null);
});

test("estimateDispersion: nulls dropped; nothing usable → null", () => {
  assert.equal(estimateDispersion([null, undefined])!, null);
  assert.equal(estimateDispersion([])!, null);
});

// ── strike profile
test("strikeProfile: ordered high→low so it reads as a price axis, not a ranking", () => {
  const p = strikeProfile([{ strike: 750, pct_of_total: -5 }, { strike: 790, pct_of_total: 8 }, { strike: 770, pct_of_total: 3 }], 772);
  assert.deepEqual(p.map((b) => b.strike), [790, 770, 750]);
});

test("strikeProfile: magnitude scales on ABSOLUTE pct — a put-dominated book must not be all stubs", () => {
  const p = strikeProfile([{ strike: 750, pct_of_total: -40 }, { strike: 790, pct_of_total: 4 }]);
  assert.equal(p.find((b) => b.strike === 750)!.magnitude, 1, "the biggest exposure is the peak, sign aside");
  assert.equal(p.find((b) => b.strike === 750)!.side, "put");
  assert.equal(p.find((b) => b.strike === 790)!.side, "call");
});

test("strikeProfile: exactly one strike is marked at spot, even on a tie", () => {
  const p = strikeProfile([{ strike: 770, pct_of_total: 1 }, { strike: 774, pct_of_total: 1 }], 772);
  assert.equal(p.filter((b) => b.atSpot).length, 1);
});

test("strikeProfile: no spot → nothing marked; empty → empty", () => {
  assert.equal(strikeProfile([{ strike: 770, pct_of_total: 1 }], null).filter((b) => b.atSpot).length, 0);
  assert.deepEqual(strikeProfile([], 100), []);
  assert.deepEqual(strikeProfile(null), []);
});

// ── implied vs realized — the question the reaction-data fix unblocked
test("impliedVsRealized: uses ABSOLUTE moves — signed ones would average to a false 'no move'", () => {
  const r = impliedVsRealized(6, [8, -8, 7, -7])!;
  assert.equal(r.medianRealized, 7.5, "a +8 and a -8 quarter are both 8-point moves");
  // Signed averaging would have produced a median near 0 and called 6% wildly rich.
  assert.ok(r.ratio! < 1, "implied sits below the typical delivered move");
});

test("impliedVsRealized: the fair band is wide on purpose — a 20% gap is 'too close to say'", () => {
  // 6 / 7.5 = 0.80, inside the +/-25% band. On an 8-quarter sample that is not a callable edge,
  // and a verdict that fires on it would be noise dressed as a signal.
  assert.equal(impliedVsRealized(6, [8, -8, 7, -7])!.verdict, "fair");
  // Clearly outside the band, though, must call it.
  assert.equal(impliedVsRealized(4, [8, 8, 7, 7])!.verdict, "cheap");
});

test("impliedVsRealized: flags options pricing MORE than the name delivers", () => {
  const r = impliedVsRealized(12, [3, 4, 3.5, 5])!;
  assert.ok(r.ratio! > 2);
  assert.equal(r.verdict, "rich");
  assert.equal(r.exceedRate, 0, "no past print exceeded the implied move");
});

test("impliedVsRealized: a wide fair band — 8 quarters cannot support a finer call", () => {
  assert.equal(impliedVsRealized(10, [9, 10, 11])!.verdict, "fair");
  assert.equal(impliedVsRealized(10.5, [10, 10, 10])!.verdict, "fair");
});

test("impliedVsRealized: exceedRate counts how often the name outran the current pricing", () => {
  const r = impliedVsRealized(5, [2, 6, 8, 3])!;
  assert.equal(r.exceedRate, 0.5);
  assert.equal(r.n, 4);
});

test("impliedVsRealized: median leads, so one gap quarter cannot set the verdict", () => {
  // Mean here is 12.75 (dragged by the 40), median is 4 — the verdict must follow the median.
  const r = impliedVsRealized(10, [3, 4, 4, 40])!;
  assert.equal(r.medianRealized, 4);
  assert.equal(r.verdict, "rich", "10% implied against a 4% typical move is rich");
});

test("impliedVsRealized: no implied or no history → null, never a fabricated comparison", () => {
  assert.equal(impliedVsRealized(null, [5, 6]), null);
  assert.equal(impliedVsRealized(6, []), null);
  assert.equal(impliedVsRealized(6, [null, undefined]), null);
  assert.equal(impliedVsRealized(0, [5]), null);
});

/* ── layoutRailLabels ───────────────────────────────────────────────────────────────── */

/** Overlap in track-fractions between two placed labels. <= 0 means they are clear. */
function railOverlap(
  a: { pos: number; tier: number },
  aw: number,
  b: { pos: number; tier: number },
  bw: number
): number {
  if (a.tier !== b.tier) return 0;
  return Math.min(a.pos + aw / 2, b.pos + bw / 2) - Math.max(a.pos - aw / 2, b.pos - bw / 2);
}

test("layoutRailLabels: the live collision — 'call wall' and 'king' at the right edge", () => {
  // Reproduces what was observed on the Meridian positioning rail: two wide labels a couple of
  // percent apart, hard against the right end, printed as one garbled string.
  const items = [
    { pos: 0.93, widthFrac: 0.16 }, // "call wall"
    { pos: 0.97, widthFrac: 0.08 }, // "king"
  ];
  const out = layoutRailLabels(items);
  assert.equal(railOverlap(out[0]!, 0.16, out[1]!, 0.08) <= 0.001, true, "labels still overlap");
  for (const [i, s] of out.entries()) {
    const half = items[i]!.widthFrac / 2;
    assert.ok(s.pos - half >= -1e-9 && s.pos + half <= 1 + 1e-9, "label hangs off the track");
  }
});

test("layoutRailLabels: a lone label stays exactly on its tick", () => {
  const out = layoutRailLabels([{ pos: 0.4, widthFrac: 0.1 }]);
  assert.deepEqual(out, [{ pos: 0.4, tier: 0 }]);
});

test("layoutRailLabels: labels that already fit are not moved or tiered", () => {
  const out = layoutRailLabels([
    { pos: 0.1, widthFrac: 0.08 },
    { pos: 0.5, widthFrac: 0.08 },
    { pos: 0.9, widthFrac: 0.08 },
  ]);
  assert.deepEqual(out.map((s) => s.tier), [0, 0, 0]);
  assert.deepEqual(out.map((s) => s.pos), [0.1, 0.5, 0.9]);
});

test("layoutRailLabels: an edge label is pulled fully inside the track", () => {
  const [left, right] = layoutRailLabels([
    { pos: 0, widthFrac: 0.2 },
    { pos: 1, widthFrac: 0.2 },
  ]);
  assert.equal(left!.pos, 0.1);
  assert.equal(right!.pos, 0.9);
});

test("layoutRailLabels: a crowded rail never overlaps within a tier", () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ pos: 0.3 + i * 0.02, widthFrac: 0.12 }));
  const out = layoutRailLabels(items, 3);
  for (let i = 0; i < out.length; i++)
    for (let j = i + 1; j < out.length; j++)
      assert.ok(
        railOverlap(out[i]!, items[i]!.widthFrac, out[j]!, items[j]!.widthFrac) <= 0.001,
        `labels ${i} and ${j} overlap on tier ${out[i]!.tier}`
      );
});

test("layoutRailLabels: input order is preserved in the output", () => {
  const out = layoutRailLabels([
    { pos: 0.8, widthFrac: 0.05 },
    { pos: 0.2, widthFrac: 0.05 },
  ]);
  assert.ok(out[0]!.pos > out[1]!.pos, "the result is indexed by input, not by sorted position");
});

test("railLabelWidthPx reproduces the four label boxes measured on live prod", () => {
  // The layout is exact given honest widths. It was being handed 31-43% of the truth, which is
  // the ROOT cause of both rail defects — the clamp under-pulls and the tiering under-fires.
  // Boxes read off prod 2026-08-21, 430px, BEKE, track 355.22px.
  const live: Array<[string, string, number]> = [
    ["put wall", "15.00", 110.91],
    ["call wall", "17.00", 117.45],
    ["king", "17.00", 83.69],
    ["max pain", "17.00", 110.7],
  ];
  for (const [label, price, real] of live) {
    const est = railLabelWidthPx(label, price);
    assert.ok(
      Math.abs(est - real) <= MV_RAIL_LABEL_SLACK_PX + 0.5,
      `"${label} ${price}": estimated ${est.toFixed(2)}px against ${real}px drawn`
    );
    // Never UNDER-estimate: too narrow is the direction that prints two prices on top of
    // each other, and it is the direction the shipped constant was wrong in.
    assert.ok(est >= real, `"${label} ${price}" estimated ${est.toFixed(2)}px < ${real}px drawn`);
  }

  // The number is half the label on a short name. Counting only `m.label` — what shipped — has
  // to be visibly wrong here, or this test is pinning nothing.
  assert.ok(
    railLabelWidthPx("king", "17.00") > 2 * railLabelWidthPx("king", ""),
    "the price must contribute at least as much width as the word on a short label"
  );
});

test("the rail label advance is pinned to the font it is measuring", () => {
  // The shipped constant was documented as "the 0.46rem mono face" while the stylesheet had moved
  // to 0.64rem — a 39% under-estimate that nothing could catch, because the constant was a bare
  // px literal with no link back to the type it modelled. Both inputs to the advance are pinned:
  // letter-spacing is part of a character's advance, so a change to it invalidates the ratio just
  // as surely as a change to the size.
  const css = readFileSync(join(process.cwd(), "src/app/desk-app.css"), "utf8");
  const rule = /\.mv-rail-marker-label\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
  assert.ok(rule, ".mv-rail-marker-label must exist in desk-app.css");

  const size = /font-size:\s*([\d.]+)rem/.exec(rule);
  assert.ok(size, ".mv-rail-marker-label must declare a font-size");
  assert.equal(
    Number(size[1]) * 16,
    MV_RAIL_LABEL_FONT_PX,
    `CSS font-size ${size?.[1]}rem disagrees with MV_RAIL_LABEL_FONT_PX ${MV_RAIL_LABEL_FONT_PX}px`
  );

  const ls = /letter-spacing:\s*([\d.]+)em/.exec(rule);
  assert.ok(ls, ".mv-rail-marker-label must declare a letter-spacing");
  assert.equal(
    Number(ls[1]),
    MV_RAIL_LABEL_LETTER_SPACING_EM,
    "letter-spacing is baked into the measured advance — changing it invalidates the ratio"
  );
});

test("layoutRailLabels: the clamp must not push a label back onto the one it was clearing", () => {
  // THE SECOND MOBILE DEFECT, and the more damaging of the two: not a near-miss but a FULL
  // overlap, two labels drawn at the same tier and the same y.
  //
  // When every tier is occupied the layout nudges the label clear of its neighbour, then clamps
  // it to keep it on the track. At the RIGHT edge the clamp wins, and it puts the label straight
  // back where it started. Measured on prod 2026-08-21, 430px, Report tab, track width 355.22px:
  //
  //   "max pain 17.00"  left 239.07  width 110.70   tier 1
  //   "king 17.00"      left 292.22  width  83.69   tier 1   <- 57.6px of the same row
  //   audit: `"17.00" ∩ "17.00"  ox 24  oy 12`, ay 1380.66 == by 1380.66
  //
  // Identical y is the signature. A narrow track hits it easily because each label is a much
  // larger fraction of the width than it is on desktop.
  const TRACK = 355.22;
  const live = [
    { label: "put wall 15.00", pos: 0.106, widthFrac: 110.91 / TRACK },
    { label: "call wall 17.00", pos: 0.677, widthFrac: 117.45 / TRACK },
    { label: "king 17.00", pos: 0.677, widthFrac: 83.69 / TRACK },
    { label: "max pain 17.00", pos: 0.677, widthFrac: 110.7 / TRACK },
  ];
  const slots = layoutRailLabels(live.map(({ pos, widthFrac }) => ({ pos, widthFrac })));

  const boxes = slots.map((sl, i) => ({
    name: live[i]!.label,
    tier: sl.tier,
    left: sl.pos - live[i]!.widthFrac / 2,
    right: sl.pos + live[i]!.widthFrac / 2,
  }));
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.tier !== b.tier) continue;
      const overlapPx = (Math.min(a.right, b.right) - Math.max(a.left, b.left)) * TRACK;
      assert.ok(
        overlapPx <= 0.01,
        `"${a.name}" and "${b.name}" share tier ${a.tier} and overlap by ${overlapPx.toFixed(1)}px`
      );
    }
  }

  // Every label still sits ON the track — an extra row must not be bought with an overhang.
  // Tolerance in PIXELS, not float epsilon: `layoutRailLabels` rounds its output to 5 decimals,
  // which on a 355px track is a sixteenth of a pixel of slop that no one can see.
  const EDGE_TOL_PX = 0.05;
  for (const b of boxes) {
    assert.ok(
      b.left * TRACK >= -EDGE_TOL_PX && (b.right - 1) * TRACK <= EDGE_TOL_PX,
      `"${b.name}" hangs off the track: ${(b.left * TRACK).toFixed(2)}..${(b.right * TRACK).toFixed(2)} of 0..${TRACK}`
    );
  }
});

test("layoutRailLabels: an extra row is opened only once, then it accepts the squeeze", () => {
  // The escape hatch is bounded on purpose. Rows cost vertical space in a panel that has little
  // to spare, and an unbounded ladder would walk the rail off the top of its card — a worse
  // failure than two tight labels. Six wide labels on one price cannot all be separated.
  const many = Array.from({ length: 6 }, () => ({ pos: 0.9, widthFrac: 0.3 }));
  const tiers = new Set(layoutRailLabels(many, 2).map((s) => s.tier));
  assert.deepEqual([...tiers].sort((a, b) => a - b), [0, 1, 2], "at most maxTiers + 1 rows");
});

test("layoutRailLabels: a rail that already fits gains no extra row", () => {
  // The headroom the track reserves is derived from the tier count, so an extra row costs real
  // pixels on every render. It must appear only when it prevents an overlap.
  const roomy = layoutRailLabels([
    { pos: 0.15, widthFrac: 0.12 },
    { pos: 0.5, widthFrac: 0.12 },
    { pos: 0.85, widthFrac: 0.12 },
  ]);
  assert.deepEqual(
    roomy.map((s) => s.tier),
    [0, 0, 0],
    "labels that fit side by side must all stay on the first row"
  );
});

test("layoutRailLabels: empty input is empty output, not a crash", () => {
  assert.deepEqual(layoutRailLabels([]), []);
});

/* ── refresh cadence ──────────────────────────────────────────────────────────────── */

test("detailRefreshMsFor: tightens as the print approaches", () => {
  const at = (h: number) => detailRefreshMsFor(h);
  assert.ok(at(0.5) < at(3), "minutes away must poll harder than hours away");
  assert.ok(at(3) < at(12));
  assert.ok(at(12) < at(48));
  assert.ok(at(48) < at(240), "ten days out must poll least of all");
});

test("detailRefreshMsFor: a printed name keeps the fast lane — the reaction is the live thing", () => {
  assert.equal(detailRefreshMsFor(240, true), 15_000);
  assert.equal(detailRefreshMsFor(null, true), 15_000);
});

test("detailRefreshMsFor: an unknown horizon falls back to a middling interval, not the fastest", () => {
  // Defaulting to the fast lane would let every undated event pay the imminent-print cost.
  assert.equal(detailRefreshMsFor(null), 60_000);
  assert.equal(detailRefreshMsFor(undefined), 60_000);
});

test("detailRefreshMsFor: a passed event still polls fast — the tape is what matters then", () => {
  assert.ok(detailRefreshMsFor(-2) <= 10_000);
});

test("detailRefreshMsFor: every interval is a sane positive number", () => {
  for (const h of [-100, -1, 0, 0.1, 1, 6, 24, 72, 500]) {
    const ms = detailRefreshMsFor(h);
    assert.ok(ms >= 5_000 && ms <= 600_000, `interval out of range at h=${h}: ${ms}`);
  }
});

test("hoursUntilIso: positive before, negative after, null on junk", () => {
  const now = Date.parse("2026-08-18T12:00:00Z");
  assert.equal(hoursUntilIso("2026-08-18T15:00:00Z", now), 3);
  assert.equal(hoursUntilIso("2026-08-18T09:00:00Z", now), -3);
  assert.equal(hoursUntilIso("not-a-date", now), null);
  assert.equal(hoursUntilIso(null, now), null);
});

test("the ladder's row height in CSS matches the one the resolver assumes", () => {
  // THE BUG THIS PINS. `MeridianStructureLadder` separated rows by `16 / 132` — "one row height
  // as a fraction of the ladder". The ladder is 132px, but a row renders at 20.5px, not 16px, so
  // "one row height" of separation came out 4.5px SHORT of one row height and every adjacent pair
  // overlapped. Measured live on prod (mobile 430x932, BABA positioning tab): overlaps of 4.5,
  // 4.5, 6.8 and 11.3 px; `meridian-interaction-audit.mjs` measured the same collisions
  // independently at 1440px.
  //
  // Neither a type check nor a unit test could catch it, because the two halves of the geometry
  // live in different languages: a number in TS and a pixel value in CSS. So the test reads the
  // CSS and compares. Same principle as largo-card-deadspace.mjs comparing packed ESTIMATES to
  // drawn pixels — an assumption nobody measured is exactly the kind that stays wrong.
  const css = readFileSync(join(process.cwd(), "src/app/desk-app.css"), "utf8");

  const rowH = /--mv-ladder-row-h:\s*(\d+(?:\.\d+)?)px/.exec(css);
  assert.ok(rowH, "--mv-ladder-row-h must be declared in desk-app.css");
  assert.equal(
    Number(rowH[1]),
    MV_LADDER_ROW_PX,
    `CSS row height ${rowH[1]}px disagrees with MV_LADDER_ROW_PX ${MV_LADDER_ROW_PX}px — ` +
      "the resolver would separate rows by less than a row again"
  );

  const ladderH = /\.mv-ladder\s*\{[^}]*min-height:\s*(\d+(?:\.\d+)?)px/.exec(css);
  assert.ok(ladderH, ".mv-ladder must declare a min-height");
  assert.equal(Number(ladderH[1]), MV_LADDER_HEIGHT_PX, "ladder height disagrees with the constant");

  // The row must be HEIGHT-PINNED, not free to grow — a wrapped label made one row taller than
  // the pinned height, which is how one pair reached an 11.3px overlap while its neighbours sat
  // at 4.5px.
  assert.match(css, /height:\s*var\(--mv-ladder-row-h\)/, "rows must be pinned to the row height");
  assert.match(
    css,
    /\.mv-ladder-label\s*\{[^}]*white-space:\s*nowrap/,
    "the label must not wrap, or the pinned height is not the real height"
  );
});

test("MV_LADDER_MIN_GAP really is one full row, and separating by it removes overlap", () => {
  assert.equal(MV_LADDER_MIN_GAP, MV_LADDER_ROW_PX / MV_LADDER_HEIGHT_PX);

  // The six real levels from the live BABA book, as fractions down a 132px ladder. Before the
  // fix these resolved to 16px centre gaps against 20.5px rows.
  const positions = [0.0, 0.02, 0.021, 0.42, 0.55, 0.9];
  const placed = resolveCollisions(positions, MV_LADDER_MIN_GAP);

  const sorted = [...placed].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) {
    const gapPx = (sorted[i]! - sorted[i - 1]!) * MV_LADDER_HEIGHT_PX;
    assert.ok(
      gapPx >= MV_LADDER_ROW_PX - 0.01,
      `rows ${i - 1}→${i} separated by ${gapPx.toFixed(1)}px, less than one ${MV_LADDER_ROW_PX}px row`
    );
  }
  // ORDER is the whole point of the ladder — separation must never re-sort it.
  const rank = (xs: number[]) => xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]!);
  assert.deepEqual(rank(placed), rank(positions), "resolver must preserve spatial order");
});

test("the rail's tier step is TALLER than a rail label — tiering that does not separate is not tiering", () => {
  // Measured on live prod 2026-08-21 (desktop 1440, BEKE Positioning): two markers sharing the
  // price 17.00 sat 9.92px apart with 12px label boxes, overlapping 2.08px. `layoutRailLabels`
  // was doing its job — it put them on different tiers — and CSS then stacked those tiers closer
  // together than a label is tall. The ladder's bug (#2457) in the sibling component.
  assert.ok(
    MV_RAIL_TIER_PX > MV_RAIL_LABEL_PX,
    `tier step ${MV_RAIL_TIER_PX}px must exceed the label height ${MV_RAIL_LABEL_PX}px, ` +
      "or two labels on different tiers still print through each other"
  );

  const css = readFileSync(join(process.cwd(), "src/app/desk-app.css"), "utf8");

  const tier = /--mv-rail-tier-h:\s*(\d+(?:\.\d+)?)px/.exec(css);
  assert.ok(tier, "--mv-rail-tier-h must be declared in desk-app.css");
  assert.equal(
    Number(tier[1]),
    MV_RAIL_TIER_PX,
    `CSS tier step ${tier?.[1]}px disagrees with MV_RAIL_TIER_PX ${MV_RAIL_TIER_PX}px`
  );

  const label = /--mv-rail-label-h:\s*(\d+(?:\.\d+)?)px/.exec(css);
  assert.ok(label, "--mv-rail-label-h must be declared in desk-app.css");
  assert.equal(
    Number(label[1]),
    MV_RAIL_LABEL_PX,
    `CSS label height ${label?.[1]}px disagrees with MV_RAIL_LABEL_PX ${MV_RAIL_LABEL_PX}px`
  );

  // The label's line box must be PINNED. The `<b class="mv-rail-marker-num">` inside carries a
  // different font stack (`--mv-value`), so an unpinned line-height makes the label's height a
  // property of font fallback rather than of this stylesheet — exactly the kind of unmeasured
  // assumption this pair of constants exists to remove.
  assert.match(
    css,
    /\.mv-rail-marker-label\s*\{[^}]*line-height:\s*var\(--mv-rail-label-h\)/,
    "the rail label must pin its line-height to --mv-rail-label-h"
  );

  // Both places that consume the step must read the SAME property. The literal `0.62rem` used to
  // appear twice — the label's `top` and the track's `margin-top` headroom — with nothing tying
  // them together, so changing one silently mis-sized the other.
  assert.match(
    css,
    /top:\s*calc\(-1 \* var\(--mv-rail-label-lift\) - var\(--tier, 0\) \* var\(--mv-rail-tier-h\)\)/,
    "the label's top must be derived from --mv-rail-label-lift and --mv-rail-tier-h"
  );
  assert.match(
    css,
    /margin-top:\s*calc\(\(var\(--rail-tiers, 1\) - 1\) \* var\(--mv-rail-tier-h\) \+ var\(--mv-rail-label-lift\)\)/,
    "the track's headroom must be derived from the SAME step AND the same lift"
  );
});

/**
 * Evaluate a restricted `calc()` body — the arithmetic the browser will do, done here.
 *
 * The point is that the test must read the STYLESHEET, not a copy of the formula. When the
 * expected value is restated in TypeScript, reverting the CSS leaves the test green and the
 * defect it names undetected — which is exactly what happened on the first pass of this file.
 * Deliberately tiny: numbers, the four operators, parentheses. Anything else throws.
 */
function evalCalc(expr: string, vars: Record<string, number>): number {
  let src = expr;
  for (const [name, value] of Object.entries(vars)) {
    src = src.replaceAll(new RegExp(`var\\(${name}(?:\\s*,[^)]*)?\\)`, "g"), String(value));
  }
  src = src.replace(/px/g, "");
  if (!/^[\d\s.+\-*/()]+$/.test(src)) throw new Error(`unsupported calc(): ${expr} -> ${src}`);
  let at = 0;
  const ws = () => { while (src[at] === " " || src[at] === "\n") at += 1; };
  const primary = (): number => {
    ws();
    if (src[at] === "(") { at += 1; const v = sum(); ws(); at += 1; return v; }
    if (src[at] === "-") { at += 1; return -primary(); }
    const m = /^\d+(?:\.\d+)?/.exec(src.slice(at));
    if (!m) throw new Error(`expected a number at ${at} in ${src}`);
    at += m[0].length;
    return Number(m[0]);
  };
  const product = (): number => {
    let v = primary();
    for (ws(); src[at] === "*" || src[at] === "/"; ws()) {
      const op = src[at]; at += 1;
      const r = primary();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    for (ws(); src[at] === "+" || src[at] === "-"; ws()) {
      const op = src[at]; at += 1;
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const out = sum();
  ws();
  if (at !== src.length) throw new Error(`trailing input in ${src}`);
  return out;
}

test("evalCalc: the calc evaluator this file relies on is itself correct", () => {
  // A broken evaluator would make the geometry test below pass on anything, so it is checked
  // against hand-computed answers before it is trusted to judge the stylesheet.
  assert.equal(evalCalc("(var(--t, 1) - 1) * var(--h) + var(--l)", { "--t": 2, "--h": 16, "--l": 8.8 }), 24.8);
  assert.equal(evalCalc("(var(--t, 1) - 1) * var(--h)", { "--t": 3, "--h": 16 }), 32);
  assert.equal(evalCalc("-1 * var(--l) - var(--tier, 0) * var(--h)", { "--l": 8.8, "--tier": 1, "--h": 16 }), -24.8);
  assert.equal(evalCalc("2px + 3px * 4px", {}), 14);
  assert.throws(() => evalCalc("var(--x) + attr(data-y)", { "--x": 1 }), /unsupported calc/);
});

test("the track reserves the label LIFT as well as the tiers — prod's 7.79px bite into the head", () => {
  // The tier step being taller than a label (the test above) separates the tiers FROM EACH OTHER.
  // It says nothing about where the stack as a whole sits, and the stack sat one lift too high:
  // every label is raised `--mv-rail-label-lift` off the track before any tiering is applied, and
  // the track reserved only the tier steps. Measured on prod 2026-08-21, 430px, Positioning tab,
  // `--rail-tiers: 2`:
  //
  //   .mv-rail-head bottom 630.09 | tier-1 label 622.30..636.30  ->  7.79px of overlap
  //
  // reported by meridian-interaction-audit.mjs as `"±2.3% · chain_iv" ∩ "17.00"`.
  const css = readFileSync(join(process.cwd(), "src/app/desk-app.css"), "utf8");

  const lift = /--mv-rail-label-lift:\s*([\d.]+)rem/.exec(css);
  assert.ok(lift, "--mv-rail-label-lift must be declared in desk-app.css");
  assert.equal(
    Number(lift[1]) * 16,
    MV_RAIL_LABEL_LIFT_PX,
    `CSS lift ${lift?.[1]}rem disagrees with MV_RAIL_LABEL_LIFT_PX ${MV_RAIL_LABEL_LIFT_PX}px`
  );

  // Both calcs are read OUT of the stylesheet and evaluated, so this test fails when the
  // stylesheet regresses rather than when someone edits a duplicate of it in here.
  const reserveCalc = /\.mv-rail-track\s*\{[\s\S]*?margin-top:\s*calc\(([\s\S]*?)\);/.exec(css)?.[1];
  assert.ok(reserveCalc, ".mv-rail-track must reserve headroom with a calc()");
  const liftCalc = /\.mv-rail-marker-label\s*\{[\s\S]*?top:\s*calc\(([\s\S]*?)\);/.exec(css)?.[1];
  assert.ok(liftCalc, ".mv-rail-marker-label must position itself with a calc()");

  // `.mv-rail-head`'s margin-bottom COLLAPSES with the track's margin-top — adjacent siblings —
  // so the effective gap is the larger of the two and NOT their sum. A reserve below this buys
  // nothing at all, which is why the shipped 16px at two tiers still left the labels in the head.
  const headMargin = /\.mv-rail-head\s*\{[\s\S]*?margin-bottom:\s*([\d.]+)rem/.exec(css);
  assert.ok(headMargin, ".mv-rail-head must declare a margin-bottom");
  const HEAD_MARGIN_BOTTOM_PX = Number(headMargin[1]) * 16;
  // An absolutely positioned child is placed against the PADDING box, and the track carries a 1px
  // border, so a label starts 1px lower than the track's border-box top.
  const TRACK_BORDER_PX = 1;

  for (const tiers of [1, 2, 3]) {
    const reserved = evalCalc(reserveCalc!, {
      "--rail-tiers": tiers,
      "--mv-rail-tier-h": MV_RAIL_TIER_PX,
      "--mv-rail-label-lift": MV_RAIL_LABEL_LIFT_PX,
      "--mv-rail-label-h": MV_RAIL_LABEL_PX,
    });
    const effective = Math.max(HEAD_MARGIN_BOTTOM_PX, reserved);
    // How far the TOP row actually reaches above the track's border box, from the CSS that puts
    // it there — negative `top`, so negate it.
    const needed =
      -evalCalc(liftCalc!, {
        "--tier": tiers - 1,
        "--mv-rail-tier-h": MV_RAIL_TIER_PX,
        "--mv-rail-label-lift": MV_RAIL_LABEL_LIFT_PX,
      }) - TRACK_BORDER_PX;
    assert.ok(
      effective >= needed,
      `--rail-tiers:${tiers} reserves ${effective}px but the labels occupy ${needed}px — ` +
        `the top row bites ${(needed - effective).toFixed(2)}px into .mv-rail-head`
    );
    // ...and not WILDLY more. Over-reserving is not a collision, but it is dead space above every
    // rail on the desk, and the first attempt at this fix over-reserved by a whole label height.
    assert.ok(
      effective - needed <= MV_RAIL_LABEL_PX,
      `--rail-tiers:${tiers} reserves ${(effective - needed).toFixed(2)}px more than the labels use`
    );
  }

  // The pre-fix reserve must fail that check at two tiers, or this test proves nothing. This is
  // the defect restated as an executable claim: short by exactly the lift.
  const oldReserved = Math.max(HEAD_MARGIN_BOTTOM_PX, (2 - 1) * MV_RAIL_TIER_PX);
  const neededAtTwo = MV_RAIL_LABEL_LIFT_PX + MV_RAIL_TIER_PX - TRACK_BORDER_PX;
  assert.ok(oldReserved < neededAtTwo, "the pre-fix formula must be short here");
  assert.equal(
    Number((neededAtTwo - oldReserved).toFixed(2)),
    7.8,
    "the predicted shortfall must match the 7.79px measured on prod"
  );
});
test("two rail labels on the same price land on different tiers, far enough apart to clear", () => {
  // The live case: call wall and king node both at 17.00, so identical positions and equal widths.
  const slots = layoutRailLabels([
    { pos: 0.5, widthFrac: 0.18 },
    { pos: 0.5, widthFrac: 0.18 },
  ]);
  assert.notEqual(slots[0]!.tier, slots[1]!.tier, "identical prices must not share a tier");

  const apartPx = Math.abs(slots[0]!.tier - slots[1]!.tier) * MV_RAIL_TIER_PX;
  assert.ok(
    apartPx >= MV_RAIL_LABEL_PX,
    `tiers ${slots[0]!.tier} and ${slots[1]!.tier} are ${apartPx}px apart, ` +
      `less than a ${MV_RAIL_LABEL_PX}px label — this is the 2.08px overlap measured on prod`
  );
});

/* ── every interactive marker must say what it is ────────────────────────────────────── */

test("no control in the Meridian viz is left without an accessible name", () => {
  // The analyst price-target dots shipped as 8x8 buttons with NO text and NO aria-label — only
  // `title`, which is the last-resort fallback in the accname spec: inconsistently announced,
  // invisible on touch, and not surfaced on keyboard focus in several browsers.
  //
  // meridian-interaction-audit.mjs found them on 2026-08-21 and printed them as `" 8x8"` x6 —
  // an EMPTY label, because its probe reads `aria-label ?? textContent` and both were empty.
  // Six unnamed buttons on the Estimates tab, in a file where `.mv-ladder-row` a few hundred
  // lines away already carries a full name with its level, price and distance from spot.
  //
  // A source guard because these are React components with no DOM available here. The audit
  // measures the rendered result; this stops a NEW control being added without a name in the
  // first place, which is the cheaper place to catch it.
  const src = readFileSync(
    join(process.cwd(), "src/features/meridian/components/meridian-viz.tsx"),
    "utf8"
  );

  // Find each opening <button ...> tag by SCANNING, not by regex.
  //
  // The first version of this used /<button[\s\S]*?(?:\/>|>)/ and silently matched almost
  // nothing useful: the bare `>` alternative matches the `>` inside `onClick={() => …}`, so every
  // button carrying an arrow function was truncated at the arrow and its `/>` never seen. A
  // mutation that injected a brand-new nameless button was NOT caught. Scanning at brace depth 0
  // is the honest way to find where a JSX tag actually ends.
  const openTags: string[] = [];
  for (let i = src.indexOf("<button"); i !== -1; i = src.indexOf("<button", i + 1)) {
    let depth = 0;
    for (let j = i; j < src.length && j < i + 4000; j += 1) {
      const ch = src[j];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) {
        openTags.push(src.slice(i, j + 1));
        break;
      }
    }
  }
  assert.ok(openTags.length >= 3, `expected several buttons, found ${openTags.length}`);

  const unnamed = openTags.filter((tag) => {
    if (/aria-label/.test(tag)) return false;
    // Only SELF-CLOSING buttons are definitely nameless — one that closes with `>` may carry
    // text children, which name it perfectly well. Self-closing icon/dot controls are the risk.
    return /\/\s*>$/.test(tag);
  });
  assert.deepEqual(
    unnamed.map((t) => (/className=\{?[`"]([^`"]*)/.exec(t)?.[1] ?? "?").slice(0, 40)),
    [],
    "self-closing <button> with no aria-label — a control with no text and no name is unreachable " +
      "to a screen reader, however good its tooltip"
  );

  // ...and the dot specifically must not regress to title-only.
  const dot = /<button[\s\S]{0,700}?mv-target-dot[\s\S]{0,700}?\/>/.exec(src)?.[0] ?? "";
  assert.ok(dot, "the price-target dot must still exist");
  assert.match(dot, /aria-label=/, "the price-target dot must carry an accessible name");
});
