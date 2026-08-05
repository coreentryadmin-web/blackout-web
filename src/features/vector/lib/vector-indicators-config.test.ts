import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VECTOR_OVERLAYS,
  VECTOR_OVERLAY_FAMILIES,
  VECTOR_LEVELS,
  VECTOR_INDICATOR_GROUPS,
  isVectorOverlayId,
  isVectorOverlayFamilyId,
  isVectorLevelId,
  isVectorGexHeatmapId,
  isVectorGammaRegimeId,
  isVectorExpectedMoveConeId,
  overlayFamilyAvailability,
  VECTOR_DEFAULT_ENABLED_INDICATORS,
  defaultVectorIndicators,
  VECTOR_OPENING_RANGE_PRESETS,
  DEFAULT_OPENING_RANGE_MINUTES,
  isVectorOpeningRangeMinutes,
  openingRangeLabel,
} from "./vector-indicators-config";

test("VECTOR_OVERLAYS: unique ids, ema/sma carry a positive period, vwap does not need one", () => {
  const ids = VECTOR_OVERLAYS.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  for (const o of VECTOR_OVERLAYS) {
    assert.ok(/^#[0-9a-f]{6}$/i.test(o.color), `${o.id} has a hex colour`);
    if (o.kind === "ema" || o.kind === "sma") {
      assert.ok(typeof o.period === "number" && o.period > 0, `${o.id} has a positive period`);
    }
  }
});

test("isVectorOverlayId: accepts registry ids, rejects anything else", () => {
  assert.ok(isVectorOverlayId("vwap"));
  assert.ok(isVectorOverlayId("ema21"));
  assert.ok(!isVectorOverlayId("rsi"));
  assert.ok(!isVectorOverlayId(""));
  assert.ok(!isVectorOverlayId(null));
});

test("VECTOR_OVERLAY_FAMILIES: partition the overlays, one type per toggle, hex dot colours", () => {
  const famIds = VECTOR_OVERLAY_FAMILIES.map((f) => f.id);
  assert.equal(new Set(famIds).size, famIds.length, "family ids unique");

  // Every family's members are valid overlay ids that actually declare that family.
  const seen: string[] = [];
  for (const fam of VECTOR_OVERLAY_FAMILIES) {
    assert.ok(/^#[0-9a-f]{6}$/i.test(fam.color), `${fam.id} has a hex dot colour`);
    assert.ok(fam.memberIds.length > 0, `${fam.id} has at least one member line`);
    for (const id of fam.memberIds) {
      assert.ok(isVectorOverlayId(id), `${id} is a real overlay id`);
      const def = VECTOR_OVERLAYS.find((o) => o.id === id)!;
      assert.equal(def.family, fam.id, `${id} declares family ${fam.id}`);
      seen.push(id);
    }
  }
  // The families cover EVERY overlay exactly once (no line orphaned, none double-toggled).
  assert.deepEqual(seen.sort(), VECTOR_OVERLAYS.map((o) => o.id).sort());
});

test("isVectorOverlayFamilyId: accepts family ids, rejects individual line ids + junk", () => {
  assert.ok(isVectorOverlayFamilyId("ema"));
  assert.ok(isVectorOverlayFamilyId("vwap"));
  assert.ok(!isVectorOverlayFamilyId("ema9"), "an individual line id is not a family id");
  assert.ok(!isVectorOverlayFamilyId("rsi"));
  assert.ok(!isVectorOverlayFamilyId(null));
});

test("VECTOR_LEVELS + isVectorLevelId: hex colours, unique ids, disjoint from families", () => {
  const ids = VECTOR_LEVELS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, "level ids unique");
  for (const l of VECTOR_LEVELS) assert.ok(/^#[0-9a-f]{6}$/i.test(l.color), `${l.id} hex colour`);
  assert.ok(isVectorLevelId("fib") && isVectorLevelId("hod-lod"));
  assert.ok(!isVectorLevelId("vwap"), "overlay family id is not a level id");
  assert.ok(!isVectorLevelId(null));
  // family/level id spaces don't collide (the enabled Set holds both).
  for (const id of ids) assert.ok(!isVectorOverlayFamilyId(id), `${id} not also a family id`);
});

test("VECTOR_LEVELS: Fib and Auto-fib carry a tooltip explaining their different conventions (2026-08-05 audit fix)", () => {
  const fib = VECTOR_LEVELS.find((l) => l.id === "fib")!;
  const fibAuto = VECTOR_LEVELS.find((l) => l.id === "fib-auto")!;
  assert.ok(fib.hint && fib.hint.length > 0);
  assert.ok(fibAuto.hint && fibAuto.hint.length > 0);
  assert.notEqual(fib.hint, fibAuto.hint);
  // The tooltip carries through to the menu's flattened item list, not just the raw def.
  const kl = VECTOR_INDICATOR_GROUPS.find((g) => g.title === "Key levels")!;
  assert.equal(kl.items.find((i) => i.id === "fib")!.hint, fib.hint);
  assert.equal(kl.items.find((i) => i.id === "fib-auto")!.hint, fibAuto.hint);
});

test("overlayFamilyAvailability: full / partial / none track the bar count vs member periods", () => {
  // VWAP is a family of one needing a single bar — computable the moment there's any bar.
  assert.deepEqual(overlayFamilyAvailability("vwap", 1), { status: "full", minBars: 1, missing: [] });
  assert.equal(overlayFamilyAvailability("vwap", 0).status, "none");

  // EMA family = 9/21/50. Under 9 bars nothing draws; at 30 the 50 is still missing; at 50 all draw.
  assert.deepEqual(overlayFamilyAvailability("ema", 5), { status: "none", minBars: 9, missing: [9, 21, 50] });
  const ema30 = overlayFamilyAvailability("ema", 30);
  assert.equal(ema30.status, "partial");
  assert.deepEqual(ema30.missing, [50]);
  assert.equal(overlayFamilyAvailability("ema", 50).status, "full");

  // SMA family = 50/200 — the real motivator: a ~7-bar 60m session can't draw either.
  assert.equal(overlayFamilyAvailability("sma", 7).status, "none");
  assert.deepEqual(overlayFamilyAvailability("sma", 100).missing, [200]);
  assert.equal(overlayFamilyAvailability("sma", 200).status, "full");
});

test("isVectorGexHeatmapId: accepts the heatmap id only, rejects other toggle ids + junk", () => {
  assert.ok(isVectorGexHeatmapId("gex-heatmap"));
  assert.ok(!isVectorGexHeatmapId("expected-move"));
  assert.ok(!isVectorGexHeatmapId("flow-markers"));
  assert.ok(!isVectorGexHeatmapId("vwap"), "overlay family id is not the heatmap id");
  assert.ok(!isVectorGexHeatmapId(null));
  // id space is disjoint from the families/levels the enabled Set also holds.
  assert.ok(!isVectorOverlayFamilyId("gex-heatmap"));
  assert.ok(!isVectorLevelId("gex-heatmap"));
});

test("VECTOR_INDICATOR_GROUPS: covers every family + level + structure id exactly once (the toggle space)", () => {
  const grouped = VECTOR_INDICATOR_GROUPS.flatMap((g) => g.items.map((i) => i.id));
  const expected = [
    ...VECTOR_OVERLAY_FAMILIES.map((f) => f.id),
    ...VECTOR_LEVELS.map((l) => l.id),
    "market-structure",
    "rsi",
    "macd",
    "confluence-band",
    "flow-markers",
    "expected-move",
    "expected-move-cone",
    "gex-heatmap",
    "gamma-regime",
    "volume-profile",
  ];
  assert.deepEqual([...grouped].sort(), [...expected].sort());
});

test("expected-move-cone: opt-in companion to the flat band, in the Expected move group, OFF by default", () => {
  assert.ok(isVectorExpectedMoveConeId("expected-move-cone"));
  assert.ok(!isVectorExpectedMoveConeId("expected-move"));
  assert.ok(!isVectorExpectedMoveConeId(null));
  // Lives next to the flat band in the "Expected move" group.
  const em = VECTOR_INDICATOR_GROUPS.find((g) => g.title === "Expected move");
  assert.ok(em);
  assert.deepEqual(em!.items.map((i) => i.id), ["expected-move", "expected-move-cone"]);
  // Strictly additive: the cone must NOT be enabled on first paint.
  assert.ok(!defaultVectorIndicators().has("expected-move-cone"));
});

test("VECTOR_DEFAULT_ENABLED_INDICATORS: dealer gamma positioning on by default (gamma-regime OFF)", () => {
  assert.deepEqual([...VECTOR_DEFAULT_ENABLED_INDICATORS], ["gex-heatmap"]);
  assert.ok(defaultVectorIndicators().has("gex-heatmap"));
  assert.equal(defaultVectorIndicators().size, 1);
  // The new regime glow is opt-in — it must NOT be enabled on first paint.
  assert.ok(!defaultVectorIndicators().has("gamma-regime"));
});

test("opening-range preset config: 15m default, isVectorOpeningRangeMinutes gates the preset set, label reflects the window (2026-08-05 audit finding #7)", () => {
  assert.deepEqual([...VECTOR_OPENING_RANGE_PRESETS], [5, 15, 30, 60]);
  assert.equal(DEFAULT_OPENING_RANGE_MINUTES, 15);
  assert.ok(VECTOR_OPENING_RANGE_PRESETS.includes(DEFAULT_OPENING_RANGE_MINUTES));

  for (const m of VECTOR_OPENING_RANGE_PRESETS) assert.ok(isVectorOpeningRangeMinutes(m));
  assert.ok(!isVectorOpeningRangeMinutes(45), "45 is not one of the presets");
  assert.ok(!isVectorOpeningRangeMinutes("15"), "string, not a number");
  assert.ok(!isVectorOpeningRangeMinutes(null));

  assert.equal(openingRangeLabel(15), "Opening range (15m)");
  assert.equal(openingRangeLabel(30), "Opening range (30m)");
  assert.equal(openingRangeLabel(60), "Opening range (60m)");

  // The static registry entry (used before any member picks a preset) matches the default window.
  const orDef = VECTOR_LEVELS.find((l) => l.id === "opening-range")!;
  assert.equal(orDef.label, openingRangeLabel(DEFAULT_OPENING_RANGE_MINUTES));
});

test("no two distinct indicator ids share a hex colour across the WHOLE toggle space (2026-08-05 audit finding #6)", () => {
  // Walk every colour the config exposes: VECTOR_OVERLAYS' concrete lines, VECTOR_LEVELS, and every
  // literal colour inside VECTOR_INDICATOR_GROUPS (RSI/MACD/structure/flow/expected-move/volume-
  // profile/etc). A member with two same-coloured indicators enabled can't tell which line/marker on
  // the chart belongs to which toggle — this is the regression guard so a future addition can't
  // silently reintroduce a collision. Overlay FAMILY dots (VECTOR_OVERLAY_FAMILIES) are deliberately
  // excluded: a family dot is defined to reuse its first member overlay's colour (see
  // `VECTOR_OVERLAY_FAMILIES`'s builder), so "ema" family legitimately shares a colour with "ema9" —
  // that is not a distinct-indicator collision, it's the same colour representing the same line twice.
  const byColor = new Map<string, string[]>();
  const record = (id: string, color: string) => {
    const list = byColor.get(color) ?? [];
    list.push(id);
    byColor.set(color, list);
  };

  for (const o of VECTOR_OVERLAYS) record(o.id, o.color);
  for (const l of VECTOR_LEVELS) record(l.id, l.color);
  for (const group of VECTOR_INDICATOR_GROUPS) {
    for (const item of group.items) {
      // Skip overlay-family items here — already covered above via VECTOR_OVERLAYS, and intentionally
      // colour-sharing with their first member (see comment above).
      if (isVectorOverlayFamilyId(item.id)) continue;
      record(item.id, item.color);
    }
  }

  const collisions = [...byColor.entries()]
    .filter(([, ids]) => new Set(ids).size > 1)
    .map(([color, ids]) => `${color}: ${[...new Set(ids)].join(", ")}`);

  assert.deepEqual(collisions, [], `duplicate indicator colours found: ${collisions.join(" | ")}`);
});

test("isVectorGammaRegimeId: matches only the regime toggle id", () => {
  assert.ok(isVectorGammaRegimeId("gamma-regime"));
  assert.ok(!isVectorGammaRegimeId("gex-heatmap"));
  assert.ok(!isVectorGammaRegimeId("vwap"));
  assert.ok(!isVectorGammaRegimeId(null));
  // gamma-regime lives in the "Positioning" group alongside gex-heatmap.
  const positioning = VECTOR_INDICATOR_GROUPS.find((g) => g.title === "Positioning");
  assert.ok(positioning);
  assert.deepEqual(
    positioning!.items.map((i) => i.id).sort(),
    ["gamma-regime", "gex-heatmap"]
  );
});
