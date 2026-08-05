import { test } from "node:test";
import assert from "node:assert/strict";
import { mapSpxPlayToBadge, unavailableSpxSlayerBadge } from "@/features/spx/lib/spx-slayer-badge-map";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-payload";

function basePayload(overrides: Partial<SpxPlayPayload> = {}): SpxPlayPayload {
  return {
    available: true,
    phase: "SCANNING",
    action: "SCANNING",
    direction: null,
    grade: "D",
    score: 0,
    confidence: 0,
    headline: "No A+ setup yet — scanning all lanes.",
    thesis: "Scanning all lanes.",
    idle_message: "No A+ setup yet — scanning all lanes.",
    factors: [],
    levels: { entry: null, stop: null, target: null, invalidation: "" },
    gates: {
      passed: false,
      blocks: [],
      warnings: [],
      entry_mode: "none",
      play_idea: null,
    },
    claude: null,
    cortex: null,
    open_play: null,
    confirmations: null,
    technicals: null,
    mtf: null,
    option_ticket: null,
    watch: null,
    telemetry: null,
    lotto_play: null,
    power_play: null,
    session_phase: "cash",
    signal_committed: false,
    as_of: "2026-08-05T14:30:00.000Z",
    ...overrides,
  } as SpxPlayPayload;
}

test("mapSpxPlayToBadge: SCANNING (flat, no setup) maps straight through, no unavailable reason", () => {
  const badge = mapSpxPlayToBadge(basePayload());
  assert.equal(badge.symbol, "SPX");
  assert.equal(badge.available, true);
  assert.equal(badge.phase, "SCANNING");
  assert.equal(badge.action, "SCANNING");
  assert.equal(badge.direction, null);
  assert.equal(badge.unavailable_reason, null);
  assert.equal(badge.as_of, "2026-08-05T14:30:00.000Z");
});

test("mapSpxPlayToBadge: WATCHING carries direction/grade/score through unchanged", () => {
  const badge = mapSpxPlayToBadge(
    basePayload({
      phase: "WATCHING",
      action: "WATCHING",
      direction: "long",
      grade: "B+",
      score: 62,
      headline: "B+ bullish — almost there",
    })
  );
  assert.equal(badge.phase, "WATCHING");
  assert.equal(badge.action, "WATCHING");
  assert.equal(badge.direction, "long");
  assert.equal(badge.grade, "B+");
  assert.equal(badge.score, 62);
  assert.equal(badge.headline, "B+ bullish — almost there");
  assert.equal(badge.unavailable_reason, null);
});

test("mapSpxPlayToBadge: an OPEN position (HOLD/TRIM/SELL) maps its action/headline straight through", () => {
  const badge = mapSpxPlayToBadge(
    basePayload({
      phase: "OPEN",
      action: "TRIM",
      direction: "short",
      grade: "A",
      score: 78,
      headline: "TRIM — bank partial, trail runner",
    })
  );
  assert.equal(badge.phase, "OPEN");
  assert.equal(badge.action, "TRIM");
  assert.equal(badge.direction, "short");
  assert.equal(badge.headline, "TRIM — bank partial, trail runner");
});

test("mapSpxPlayToBadge: available:false derives unavailable_reason from idle_message", () => {
  const badge = mapSpxPlayToBadge(
    basePayload({
      available: false,
      idle_message: "Desk warming — play state unavailable",
      headline: "Desk warming — play state unavailable",
    })
  );
  assert.equal(badge.available, false);
  assert.equal(badge.unavailable_reason, "Desk warming — play state unavailable");
});

test("mapSpxPlayToBadge: available:false with no idle_message falls back to a generic reason", () => {
  const badge = mapSpxPlayToBadge(basePayload({ available: false, idle_message: null }));
  assert.equal(badge.available, false);
  assert.equal(badge.unavailable_reason, "SPX Slayer desk unavailable");
});

test("unavailableSpxSlayerBadge: shape is a valid idle badge carrying the given reason", () => {
  const badge = unavailableSpxSlayerBadge("SPX Slayer desk unavailable — retrying");
  assert.equal(badge.available, false);
  assert.equal(badge.symbol, "SPX");
  assert.equal(badge.phase, "SCANNING");
  assert.equal(badge.action, "SCANNING");
  assert.equal(badge.direction, null);
  assert.equal(badge.unavailable_reason, "SPX Slayer desk unavailable — retrying");
  assert.equal(typeof badge.as_of, "string");
});
