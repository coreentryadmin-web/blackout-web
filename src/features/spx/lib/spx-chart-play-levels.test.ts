import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  mergeSpxChartPlayLevels,
  resolveSpxChartPlayLevels,
  vectorEmitToPlayLevelsInput,
} from "./spx-chart-play-levels";
import type { VectorPlayEmit } from "@/features/vector/lib/vector-play-engine";

function vectorEmit(overrides: Partial<VectorPlayEmit> & { play?: Partial<VectorPlayEmit["play"]> } = {}): VectorPlayEmit {
  const basePlay = {
    style: "scalp" as const,
    bias: "long" as const,
    setup: "momentum-long" as const,
    conviction: 72,
    grade: "B" as const,
    headline: "Long momentum",
    thesis: "Short gamma — trade with the break",
    targets: ["7700"],
    starred: [],
    ...overrides.play,
  };
  return {
    play: basePlay,
    spot: 7680,
    callWall: 7700,
    putWall: 7650,
    magnetStrike: 7690,
    gammaFlip: 7660,
    regimePosture: "short_gamma",
    technicals: null,
    confluenceZones: [],
    darkPoolLevels: [],
    ...overrides,
  };
}

describe("spx-chart-play-levels", () => {
  test("vectorEmitToPlayLevelsInput maps long bias to spot entry and wall stops/targets", () => {
    const input = vectorEmitToPlayLevelsInput(vectorEmit());
    assert.equal(input.state, "idea");
    assert.equal(input.direction, "long");
    assert.equal(input.entry, 7680);
    assert.equal(input.stop, 7650);
    assert.equal(input.target, 7700);
  });

  test("vectorEmitToPlayLevelsInput skips stand-aside and weak C-grade", () => {
    assert.equal(
      vectorEmitToPlayLevelsInput(vectorEmit({ play: { setup: "stand-aside", bias: "neutral" } })).state,
      "none"
    );
    assert.equal(
      vectorEmitToPlayLevelsInput(vectorEmit({ play: { grade: "C", conviction: 40 } })).state,
      "none"
    );
  });

  test("mergeSpxChartPlayLevels prefers open slayer over vector idea", () => {
    const slayer = {
      state: "open" as const,
      direction: "long" as const,
      entry: 7685,
      stop: 7640,
      target: 7720,
      invalidation: null,
    };
    const vector = vectorEmitToPlayLevelsInput(vectorEmit());
    const merged = mergeSpxChartPlayLevels(slayer, vector);
    assert.equal(merged.entry, 7685);
    assert.equal(merged.state, "open");
  });

  test("resolveSpxChartPlayLevels falls back to vector when slayer is scanning", () => {
    const merged = resolveSpxChartPlayLevels(
      { action: "SCANNING", direction: "long", levels: { entry: null } },
      vectorEmit()
    );
    assert.equal(merged.state, "idea");
    assert.equal(merged.target, 7700);
  });

  test("resolveSpxChartPlayLevels uses slayer BUY idea over vector", () => {
    const merged = resolveSpxChartPlayLevels(
      {
        action: "BUY",
        direction: "long",
        levels: { entry: 7682, stop: 7660, target: 7710 },
      },
      vectorEmit()
    );
    assert.equal(merged.state, "idea");
    assert.equal(merged.entry, 7682);
    assert.equal(merged.target, 7710);
  });
});
