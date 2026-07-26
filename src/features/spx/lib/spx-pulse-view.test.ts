import { test } from "node:test";
import assert from "node:assert/strict";

import {
  kindView,
  orderPulseFeed,
  signalPassesFilter,
  SPX_PULSE_KIND_VIEW,
  SPX_PULSE_FILTERS,
} from "./spx-pulse-view";
import type { PulseSignal, PulseSignalKind } from "@/features/vector/lib/vector-pulse";
import { TIER_BY_KIND } from "@/features/vector/lib/vector-pulse";

function sig(kind: PulseSignalKind, at = 1000, tier?: 1 | 2 | 3): PulseSignal {
  return { key: `${kind}:${at}`, kind, tone: "info", line: kind, at, tier };
}

test("typed colors: the color-by-type contract matches the spec", () => {
  assert.equal(kindView("regime-flip").color, "#fbbf24"); // amber
  assert.equal(kindView("wall-break").color, "#38bdf8"); // blue
  assert.equal(kindView("magnet-shift").color, "#a78bfa"); // purple
  assert.equal(kindView("pin-shift").color, "#a78bfa"); // purple
  assert.equal(kindView("flow-print").color, "#22d3ee"); // cyan
  assert.equal(kindView("vol-regime").color, "#fb923c"); // orange
  assert.equal(kindView("macro-window").color, "#f87171"); // red
  assert.equal(kindView("play-state").color, "#34d399"); // green
});

test("every PulseSignalKind has a total view + tier mapping", () => {
  for (const kind of Object.keys(TIER_BY_KIND) as PulseSignalKind[]) {
    assert.ok(SPX_PULSE_KIND_VIEW[kind], `missing view for ${kind}`);
    assert.ok(kindView(kind).badge.length > 0);
  }
});

test("orderPulseFeed pins Tier-1 above the stream (render-per-tier)", () => {
  const feed = [
    sig("flow-print", 5000), // tier 3
    sig("regime-flip", 4000), // tier 1
    sig("magnet-shift", 3000), // tier 2
    sig("wall-break", 2000), // tier 1
  ];
  const { pinned, stream } = orderPulseFeed(feed);
  assert.deepEqual(pinned.map((s) => s.kind), ["regime-flip", "wall-break"]);
  assert.deepEqual(stream.map((s) => s.kind), ["flow-print", "magnet-shift"]);
});

test("filter chips route each kind to its category", () => {
  assert.ok(signalPassesFilter(sig("regime-flip"), "regime"));
  assert.ok(signalPassesFilter(sig("vol-regime"), "regime"));
  assert.ok(signalPassesFilter(sig("wall-break"), "walls"));
  assert.ok(signalPassesFilter(sig("pin-shift"), "walls"));
  assert.ok(signalPassesFilter(sig("flow-print"), "flow"));
  assert.ok(signalPassesFilter(sig("macro-window"), "macro"));
  assert.ok(signalPassesFilter(sig("play-state"), "plays"));
  // "All" always passes; a mismatched filter excludes.
  assert.ok(signalPassesFilter(sig("flow-print"), "all"));
  assert.equal(signalPassesFilter(sig("flow-print"), "macro"), false);
});

test("session-phase only shows under All (no dedicated chip)", () => {
  assert.equal(kindView("session-phase").category, "session");
  assert.equal(
    SPX_PULSE_FILTERS.some((f) => f.id === "session"),
    false
  );
  assert.ok(signalPassesFilter(sig("session-phase"), "all"));
  assert.equal(signalPassesFilter(sig("session-phase"), "regime"), false);
});
