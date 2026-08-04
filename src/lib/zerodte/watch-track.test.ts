import assert from "node:assert/strict";
import test from "node:test";
import {
  watchReferencePremium,
  watchTrackPct,
  watchUnderlyingTrackPct,
} from "./watch-track.ts";

test("watchReferencePremium: flow fill wins over entry max", () => {
  assert.equal(watchReferencePremium({ flow_avg_fill: 4.2, entry_max: 5.0 }), 4.2);
  assert.equal(watchReferencePremium({ flow_avg_fill: null, entry_max: 3.5 }), 3.5);
  assert.equal(watchReferencePremium({ flow_avg_fill: 0, entry_max: 2 }), 2);
  assert.equal(watchReferencePremium(null), null);
});

test("watchTrackPct: premium move vs anchor — null when ungrounded", () => {
  assert.equal(watchTrackPct(4.0, 5.0), 25);
  assert.equal(watchTrackPct(4.0, 3.0), -25);
  assert.equal(watchTrackPct(null, 5.0), null);
  assert.equal(watchTrackPct(4.0, null), null);
});

test("watchUnderlyingTrackPct: signed stock move since flag", () => {
  assert.equal(watchUnderlyingTrackPct("LONG", 100, 105), 5);
  assert.equal(watchUnderlyingTrackPct("SHORT", 100, 95), 5);
  assert.equal(watchUnderlyingTrackPct("SHORT", 100, 105), -5);
  assert.equal(watchUnderlyingTrackPct("LONG", null, 105), null);
});
