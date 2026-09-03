import assert from "node:assert/strict";
import { test } from "node:test";
import { spxDeskLaneFreshness } from "./spx-desk-lane-freshness";

const NOW = Date.parse("2026-09-03T16:00:00.000Z");

test("spxDeskLaneFreshness: fresh pulse/desk/flow lanes read live during RTH", () => {
  const layers = spxDeskLaneFreshness({
    nowMs: NOW,
    sessionActive: true,
    pulsePolledAt: new Date(NOW - 1_000).toISOString(),
    deskPolledAt: new Date(NOW - 1_500).toISOString(),
    flowPolledAt: new Date(NOW - 1_200).toISOString(),
  });
  assert.equal(layers.length, 3);
  assert.equal(layers.every((l) => l.status === "live"), true);
});

test("spxDeskLaneFreshness: desk lane goes stale when polled_at is too old", () => {
  const layers = spxDeskLaneFreshness({
    nowMs: NOW,
    sessionActive: true,
    pulsePolledAt: new Date(NOW - 1_000).toISOString(),
    deskPolledAt: new Date(NOW - 12_000).toISOString(),
    flowPolledAt: new Date(NOW - 1_200).toISOString(),
  });
  const desk = layers.find((l) => l.lane === "desk");
  assert.equal(desk?.status, "stale");
});

test("spxDeskLaneFreshness: feed_stalled downgrades pulse from live to stale", () => {
  const layers = spxDeskLaneFreshness({
    nowMs: NOW,
    sessionActive: true,
    pulsePolledAt: new Date(NOW - 500).toISOString(),
    feedStalled: true,
  });
  const pulse = layers.find((l) => l.lane === "pulse");
  assert.equal(pulse?.status, "stale");
});

test("spxDeskLaneFreshness: off-hours with cached timestamps reads cached", () => {
  const layers = spxDeskLaneFreshness({
    nowMs: NOW,
    sessionActive: false,
    deskPolledAt: new Date(NOW - 60_000).toISOString(),
  });
  assert.equal(layers.find((l) => l.lane === "desk")?.status, "cached");
});
