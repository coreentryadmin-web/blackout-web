import { test } from "node:test";
import assert from "node:assert/strict";
import { playLevelLines, PLAY_LEVEL_COLORS, type PlayLevelsInput } from "./vector-play-levels";

const OPEN_LONG: PlayLevelsInput = {
  state: "open",
  direction: "long",
  entry: 6061,
  stop: 6040,
  target: 6100,
  invalidation: 6035,
};

test("state 'none' draws nothing", () => {
  assert.deepEqual(playLevelLines({ ...OPEN_LONG, state: "none" }), []);
});

test("open play draws entry/stop/target/invalidation, solid+bold", () => {
  const lines = playLevelLines(OPEN_LONG);
  const byKind = Object.fromEntries(lines.map((l) => [l.kind, l]));
  assert.equal(lines.length, 4);
  assert.equal(byKind.entry!.style, "solid");
  assert.equal(byKind.entry!.width, 2);
  assert.equal(byKind.stop!.color, PLAY_LEVEL_COLORS.stop);
  assert.equal(byKind.target!.color, PLAY_LEVEL_COLORS.target);
  assert.equal(byKind.invalidation!.color, PLAY_LEVEL_COLORS.invalidation);
  // Direction word + formatted price fold into the label.
  assert.match(byKind.entry!.label, /LONG entry 6,061/);
  assert.match(byKind.stop!.label, /LONG stop 6,040/);
});

test("idea state draws faint dotted lines (thin), entry dashed", () => {
  const lines = playLevelLines({ ...OPEN_LONG, state: "idea" });
  const byKind = Object.fromEntries(lines.map((l) => [l.kind, l]));
  assert.equal(byKind.stop!.style, "dotted");
  assert.equal(byKind.stop!.width, 1);
  assert.equal(byKind.entry!.style, "dashed");
});

test("short direction labels read SHORT", () => {
  const lines = playLevelLines({ ...OPEN_LONG, direction: "short" });
  assert.match(lines.find((l) => l.kind === "target")!.label, /SHORT target/);
});

test("non-finite / null / non-positive levels are dropped, not fabricated", () => {
  const lines = playLevelLines({
    state: "open",
    direction: "long",
    entry: 6061,
    stop: null,
    target: Number.NaN,
    invalidation: 0,
  });
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["entry"]
  );
});

test("missing direction omits the word but still draws the level", () => {
  const lines = playLevelLines({ ...OPEN_LONG, direction: null });
  const entry = lines.find((l) => l.kind === "entry")!;
  assert.equal(entry.label, "entry 6,061");
});
