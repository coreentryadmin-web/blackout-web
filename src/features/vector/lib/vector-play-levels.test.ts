import { test } from "node:test";
import assert from "node:assert/strict";
import {
  playLevelLines,
  playPayloadToLevelsInput,
  PLAY_LEVEL_COLORS,
  type PlayLevelsInput,
} from "./vector-play-levels";

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

// ── playPayloadToLevelsInput: SpxPlayPayload → PlayLevelsInput ──────────────

test("open_play maps to state 'open' with the open row's levels", () => {
  const input = playPayloadToLevelsInput({
    action: "HOLD",
    direction: "long",
    levels: { entry: 6100, stop: 6080, target: 6150, invalidation: "Below 6070 (GEX)" },
    open_play: { direction: "short", entry_price: 6061, stop: 6080, target: 6000 },
  });
  assert.equal(input.state, "open");
  // open_play wins over top-level direction/levels — it's the committed trade.
  assert.equal(input.direction, "short");
  assert.equal(input.entry, 6061);
  assert.equal(input.stop, 6080);
  assert.equal(input.target, 6000);
  // Descriptive-string invalidation coerces to null (never drawn as a fabricated price).
  assert.equal(input.invalidation, null);
});

test("BUY idea with a finite entry maps to state 'idea'", () => {
  const input = playPayloadToLevelsInput({
    action: "BUY",
    direction: "long",
    levels: { entry: 6100, stop: 6080, target: 6150, invalidation: "Below 6070" },
    open_play: null,
  });
  assert.equal(input.state, "idea");
  assert.equal(input.direction, "long");
  assert.equal(input.entry, 6100);
  assert.equal(input.stop, 6080);
  assert.equal(input.target, 6150);
});

test("WATCHING idea maps to state 'idea' (real action enum, not 'WATCH')", () => {
  const input = playPayloadToLevelsInput({
    action: "WATCHING",
    direction: "short",
    levels: { entry: 6100, stop: 6120, target: 6040, invalidation: null },
  });
  assert.equal(input.state, "idea");
  assert.equal(input.direction, "short");
});

test("SCANNING / SELL / no play → state 'none' (draws nothing)", () => {
  for (const action of ["SCANNING", "SELL"]) {
    const input = playPayloadToLevelsInput({
      action,
      direction: "long",
      levels: { entry: 6100, stop: 6080, target: 6150, invalidation: null },
    });
    assert.equal(input.state, "none", `${action} must not draw`);
  }
  assert.equal(playPayloadToLevelsInput(null).state, "none");
  assert.equal(playPayloadToLevelsInput(undefined).state, "none");
  // A BUY with no finite entry is not a drawable idea.
  assert.equal(
    playPayloadToLevelsInput({ action: "BUY", direction: "long", levels: { entry: null } }).state,
    "none"
  );
});

test("missing / non-finite fields become null, never NaN or undefined", () => {
  const input = playPayloadToLevelsInput({
    open_play: {
      direction: "banana" as unknown as "long",
      entry_price: 6061,
      stop: Number.NaN,
      target: undefined,
    },
  });
  assert.equal(input.state, "open");
  assert.equal(input.direction, null); // unknown direction word → null
  assert.equal(input.entry, 6061);
  assert.equal(input.stop, null);
  assert.equal(input.target, null);
  assert.equal(input.invalidation, null);
  // No NaN anywhere.
  for (const v of [input.entry, input.stop, input.target, input.invalidation]) {
    assert.ok(v === null || Number.isFinite(v));
  }
});
