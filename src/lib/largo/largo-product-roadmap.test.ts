import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  questionWantsCompareCard,
} from "@/lib/largo/desk-prompts";
import { extractWatchlistFromText, normalizeWatchlist } from "@/lib/largo/session-metadata";
import { parseLargoDepth, largoDepthConfig } from "@/lib/largo/largo-depth";
import { buildLargoActions } from "@/lib/largo/largo-actions";

describe("desk-prompts", () => {
  it("questionWantsCompareCard detects flow vs gex", () => {
    assert.equal(questionWantsCompareCard("Compare HELIX flow vs Thermal GEX on SPX"), true);
    assert.equal(questionWantsCompareCard("What's SPX at?"), false);
  });
});

describe("session-metadata watchlist", () => {
  it("extracts remember I trade SPX and NVDA", () => {
    assert.deepEqual(extractWatchlistFromText("Remember I trade SPX and NVDA"), ["SPX", "NVDA"]);
  });

  it("normalizeWatchlist caps and dedupes", () => {
    assert.deepEqual(normalizeWatchlist(["spy", "SPY", "nvda"]), ["SPY", "NVDA"]);
  });
});

describe("largo-depth", () => {
  it("quick uses Haiku and 2 rounds", () => {
    assert.equal(parseLargoDepth("quick"), "quick");
    assert.equal(largoDepthConfig("quick").maxRounds, 2);
    assert.match(largoDepthConfig("quick").model, /haiku/i);
  });

  it("deep uses Sonnet", () => {
    assert.match(largoDepthConfig("deep").model, /sonnet/i);
  });
});

describe("largo-actions", () => {
  it("builds thermal flip link when flip present", () => {
    const actions = buildLargoActions({
      ticker: "SPX",
      compareCard: {
        ticker: "SPX",
        as_of: "",
        helix: { available: true, bias: "bullish", summary: "" },
        thermal: {
          available: true,
          bias: "bearish",
          summary: "",
          flip: 5800,
        },
        conflict: true,
        conflict_note: "x",
      },
    });
    assert.ok(actions.some((a) => a.id === "thermal-flip" && a.href.includes("5800")));
  });
});
