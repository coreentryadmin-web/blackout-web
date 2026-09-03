import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  computeDeskAlignment,
  slayerSuggestedBias,
  vectorSuggestedBias,
} from "./spx-desk-convergence-core";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-payload";
import type { VectorPlay } from "@/features/vector/lib/vector-play-engine";

function slayer(overrides: Partial<SpxPlayPayload> = {}): SpxPlayPayload {
  return {
    available: true,
    phase: "WATCHING",
    action: "WATCHING",
    direction: "long",
    grade: "B",
    score: 62,
    rawScore: 62,
    headline: "Watch long",
    thesis: "",
    idle_message: null,
    factors: [],
    levels: { entry: null, stop: null, target: null, invalidation: "" },
    gates: { passed: false, blocks: [], warnings: [], entry_mode: "cold", play_idea: null },
    claude: null,
    cortex: null,
    open_play: null,
    confirmations: null,
    technicals: null,
    mtf: null,
    option_ticket: null,
    watch: { active: true, promote_ready: false, armed_at: null, direction: "long" },
    signal_committed: false,
    session_phase: "rth",
    ...overrides,
  } as SpxPlayPayload;
}

function vectorPlay(overrides: Partial<VectorPlay> = {}): VectorPlay {
  return {
    style: "scalp",
    bias: "long",
    setup: "momentum-long",
    conviction: 70,
    grade: "B",
    headline: "Long momentum",
    thesis: "Break with flow",
    targets: ["5900"],
    starred: [],
    ...overrides,
  };
}

describe("spx-desk-convergence", () => {
  test("slayerSuggestedBias reads direction and open play", () => {
    assert.equal(slayerSuggestedBias(slayer({ direction: "short" })), "short");
    assert.equal(
      slayerSuggestedBias(slayer({ direction: null, open_play: { direction: "long" } as SpxPlayPayload["open_play"] })),
      "long"
    );
    assert.equal(slayerSuggestedBias(null), "none");
  });

  test("vectorSuggestedBias skips stand-aside", () => {
    assert.equal(vectorSuggestedBias({ play: vectorPlay() } as never), "long");
    assert.equal(
      vectorSuggestedBias({ play: vectorPlay({ setup: "stand-aside", bias: "neutral" }) } as never),
      "neutral"
    );
    assert.equal(vectorSuggestedBias(null), "none");
  });

  test("computeDeskAlignment flags aligned and divergent", () => {
    assert.equal(computeDeskAlignment("long", "long"), "aligned");
    assert.equal(computeDeskAlignment("short", "long"), "divergent");
    assert.equal(computeDeskAlignment("long", "none"), "slayer_leads");
    assert.equal(computeDeskAlignment("neutral", "short"), "vector_leads");
    assert.equal(computeDeskAlignment("neutral", "neutral"), "flat");
  });
});
