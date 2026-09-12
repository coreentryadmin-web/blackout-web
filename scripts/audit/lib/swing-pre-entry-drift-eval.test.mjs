import test from "node:test";
import assert from "node:assert/strict";
import {
  signAlignedMovePct,
  classifyPreEntryDrift,
  mostFavorableCloseInWindow,
  closeAtOrBefore,
  findRealFirstSeenAt,
} from "./swing-pre-entry-drift-eval.mjs";

test("findRealFirstSeenAt: matches the accumulation row whose promoted_position_id equals the closed position's id", () => {
  const rows = [
    { ticker: "AAPL", promoted_position_id: 36, first_seen_at: "2026-09-02T16:01:53.000Z" },
    { ticker: "NN", promoted_position_id: 32, first_seen_at: "2026-09-01T16:01:52.000Z" },
  ];
  assert.equal(findRealFirstSeenAt(rows, 36), "2026-09-02T16:01:53.000Z");
});

test("findRealFirstSeenAt: still-pending rows (promoted_position_id null) never match a real position", () => {
  const rows = [{ ticker: "TSLA", promoted_position_id: null, first_seen_at: "2026-09-05T00:00:00.000Z" }];
  assert.equal(findRealFirstSeenAt(rows, 36), null);
});

test("findRealFirstSeenAt: no matching row -> null, a real disclosed gap (never guessed)", () => {
  assert.equal(findRealFirstSeenAt([], 99), null);
});

test("signAlignedMovePct: LONG favorable move is a price increase, positive pct", () => {
  assert.equal(signAlignedMovePct({ fromPrice: 100, toPrice: 110, direction: "LONG" }), 10);
});

test("signAlignedMovePct: SHORT favorable move is a price decline, sign-flipped to positive", () => {
  assert.equal(signAlignedMovePct({ fromPrice: 100, toPrice: 90, direction: "SHORT" }), 10);
});

test("signAlignedMovePct: SHORT adverse move (price rose) reads negative, not fabricated positive", () => {
  assert.equal(signAlignedMovePct({ fromPrice: 100, toPrice: 110, direction: "SHORT" }), -10);
});

test("signAlignedMovePct: missing/invalid prices return null, never a guessed move", () => {
  assert.equal(signAlignedMovePct({ fromPrice: null, toPrice: 100, direction: "LONG" }), null);
  assert.equal(signAlignedMovePct({ fromPrice: 100, toPrice: 0, direction: "LONG" }), null);
  assert.equal(signAlignedMovePct({ fromPrice: 100, toPrice: NaN, direction: "LONG" }), null);
});

test("classifyPreEntryDrift: both legs favorable -> measurable, driftFraction in (0,1)", () => {
  const r = classifyPreEntryDrift({ preEntryMovePct: 5, postEntryMovePct: 15 });
  assert.equal(r.bucket, "measurable");
  assert.equal(r.driftFraction, 5 / 20);
});

test("classifyPreEntryDrift: no favorable pre-entry drift -> driftFraction 0 by convention", () => {
  const r = classifyPreEntryDrift({ preEntryMovePct: -3, postEntryMovePct: 20 });
  assert.equal(r.bucket, "no_pre_entry_drift");
  assert.equal(r.driftFraction, 0);
});

test("classifyPreEntryDrift: no post-entry capture -> driftFraction null, not a divide-by-zero fabrication", () => {
  const r = classifyPreEntryDrift({ preEntryMovePct: 8, postEntryMovePct: -2 });
  assert.equal(r.bucket, "no_post_entry_capture");
  assert.equal(r.driftFraction, null);
});

test("classifyPreEntryDrift: missing inputs -> insufficient_data, never guessed", () => {
  const r = classifyPreEntryDrift({ preEntryMovePct: null, postEntryMovePct: 10 });
  assert.equal(r.bucket, "insufficient_data");
  assert.equal(r.driftFraction, null);
});

test("mostFavorableCloseInWindow: LONG picks the highest close inside the window", () => {
  const bars = [
    { t: 100, c: 50 },
    { t: 200, c: 55 },
    { t: 300, c: 53 },
    { t: 400, c: 60 }, // outside window
  ];
  assert.equal(mostFavorableCloseInWindow(bars, { fromMs: 100, toMs: 300, direction: "LONG" }), 55);
});

test("mostFavorableCloseInWindow: SHORT picks the lowest close inside the window", () => {
  const bars = [
    { t: 100, c: 50 },
    { t: 200, c: 45 },
    { t: 300, c: 48 },
  ];
  assert.equal(mostFavorableCloseInWindow(bars, { fromMs: 100, toMs: 300, direction: "SHORT" }), 45);
});

test("mostFavorableCloseInWindow: no bar inside the window returns null, never guesses", () => {
  const bars = [{ t: 100, c: 50 }];
  assert.equal(mostFavorableCloseInWindow(bars, { fromMs: 500, toMs: 600, direction: "LONG" }), null);
});

test("closeAtOrBefore: returns the last bar at or before the target", () => {
  const bars = [{ t: 100, c: 10 }, { t: 200, c: 12 }, { t: 300, c: 14 }];
  assert.equal(closeAtOrBefore(bars, 250), 12);
});

test("closeAtOrBefore: falls back to the first bar when target predates every bar", () => {
  const bars = [{ t: 100, c: 10 }, { t: 200, c: 12 }];
  assert.equal(closeAtOrBefore(bars, 50), 10);
});

test("closeAtOrBefore: empty bar set returns null", () => {
  assert.equal(closeAtOrBefore([], 100), null);
});
