import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveGapWindows,
  classifyGapTransition,
  findFirstDirectionalMs,
  gradeForgoneMove,
  etWallClockToUtcMs,
} from "./swing-cadence-gap-eval.mjs";

test("deriveGapWindows: the real SWING_SCAN_PHASES shape produces exactly the two known RTH gaps", () => {
  // Mirrors scan-cadence.ts's real SWING_SCAN_PHASES windows (minutes since ET midnight).
  const phases = [
    { startMin: 16 * 60 + 15, endMin: 20 * 60 }, // POST_CLOSE 16:15-20:00
    { startMin: 6 * 60, endMin: 9 * 60 + 15 }, // PRE_OPEN 6:00-9:15
    { startMin: 12 * 60, endMin: 13 * 60 }, // MIDDAY 12:00-13:00
    { startMin: 15 * 60, endMin: 16 * 60 }, // POWER_HOUR 15:00-16:00
    { startMin: 20 * 60, endMin: 24 * 60 }, // OVERNIGHT 20:00-24:00
  ];
  const gaps = deriveGapWindows(phases);
  // [0,6:00) pre-dawn, [9:15,12:00) GAP1, [13:00,15:00) GAP2, [16:00,16:15) tiny seam.
  assert.deepEqual(gaps, [
    { startMin: 0, endMin: 6 * 60 },
    { startMin: 9 * 60 + 15, endMin: 12 * 60 },
    { startMin: 13 * 60, endMin: 15 * 60 },
    { startMin: 16 * 60, endMin: 16 * 60 + 15 },
  ]);
});

test("deriveGapWindows: fully-covered day yields no gaps", () => {
  const phases = [{ startMin: 0, endMin: 24 * 60 }];
  assert.deepEqual(deriveGapWindows(phases), []);
});

test("deriveGapWindows: input order does not matter (sorts internally)", () => {
  const a = deriveGapWindows([{ startMin: 100, endMin: 200 }, { startMin: 0, endMin: 50 }]);
  const b = deriveGapWindows([{ startMin: 0, endMin: 50 }, { startMin: 100, endMin: 200 }]);
  assert.deepEqual(a, b);
});

test("classifyGapTransition: already directional before the gap started is NOT a gap miss", () => {
  assert.equal(
    classifyGapTransition({ directionalAtGapStart: true, directionalAtGapEnd: true }),
    "already_covered"
  );
});

test("classifyGapTransition: neutral throughout the gap is not a real candidate at all", () => {
  assert.equal(
    classifyGapTransition({ directionalAtGapStart: false, directionalAtGapEnd: false }),
    "never_qualified"
  );
});

test("classifyGapTransition: neutral at gap start, directional by gap end IS the gap miss this probe measures", () => {
  assert.equal(
    classifyGapTransition({ directionalAtGapStart: false, directionalAtGapEnd: true }),
    "gap_qualified"
  );
});

test("findFirstDirectionalMs: returns the first candidate confirmed directional by the injected predicate", () => {
  const candidates = [100, 200, 300, 400];
  const directionalFrom300 = (ms) => ms >= 300;
  assert.equal(findFirstDirectionalMs(candidates, directionalFrom300), 300);
});

test("findFirstDirectionalMs: returns null (never guesses) when none of the candidates qualify", () => {
  assert.equal(findFirstDirectionalMs([100, 200], () => false), null);
});

test("gradeForgoneMove: bull direction — price already ran up before discovery could catch up (favorable)", () => {
  const g = gradeForgoneMove({ qualifyingPrice: 100, catchUpPrice: 102, direction: "bull", favThresholdPct: 1 });
  assert.equal(g.movePct, 2);
  assert.equal(g.favorable, true);
});

test("gradeForgoneMove: bear direction sign-flips the raw move to the candidate's own thesis", () => {
  // Price FELL 2% -- favorable for a bear thesis, even though the raw pct is negative.
  const g = gradeForgoneMove({ qualifyingPrice: 100, catchUpPrice: 98, direction: "bear", favThresholdPct: 1 });
  assert.equal(g.movePct, 2);
  assert.equal(g.favorable, true);
});

test("gradeForgoneMove: below the favorable threshold reads as NOT favorable, not fabricated as a loss", () => {
  const g = gradeForgoneMove({ qualifyingPrice: 100, catchUpPrice: 100.3, direction: "bull", favThresholdPct: 1 });
  assert.equal(g.favorable, false);
});

test("gradeForgoneMove: missing/invalid prices return null, never a guessed move", () => {
  assert.equal(gradeForgoneMove({ qualifyingPrice: null, catchUpPrice: 100, direction: "bull", favThresholdPct: 1 }), null);
  assert.equal(gradeForgoneMove({ qualifyingPrice: 100, catchUpPrice: 0, direction: "bull", favThresholdPct: 1 }), null);
  assert.equal(gradeForgoneMove({ qualifyingPrice: 100, catchUpPrice: NaN, direction: "bull", favThresholdPct: 1 }), null);
});

test("etWallClockToUtcMs: EDT session (summer) resolves 9:15 ET to 13:15 UTC", () => {
  // 2026-07-15 is well inside EDT (UTC-4).
  const ms = etWallClockToUtcMs("2026-07-15", 9 * 60 + 15);
  const iso = new Date(ms).toISOString();
  assert.equal(iso, "2026-07-15T13:15:00.000Z");
});

test("etWallClockToUtcMs: EST session (winter) resolves 9:15 ET to 14:15 UTC", () => {
  // 2026-01-15 is well inside EST (UTC-5).
  const ms = etWallClockToUtcMs("2026-01-15", 9 * 60 + 15);
  const iso = new Date(ms).toISOString();
  assert.equal(iso, "2026-01-15T14:15:00.000Z");
});

test("etWallClockToUtcMs: round-trips through the DST transition boundary correctly", () => {
  // 2026-03-08 is the actual US spring-forward Sunday; use the Monday after (2026-03-09, EDT already
  // in effect) to assert the conversion picked up the NEW offset, not a stale pre-transition one.
  const ms = etWallClockToUtcMs("2026-03-09", 12 * 60); // noon ET
  const iso = new Date(ms).toISOString();
  assert.equal(iso, "2026-03-09T16:00:00.000Z"); // UTC-4 (EDT)
});
