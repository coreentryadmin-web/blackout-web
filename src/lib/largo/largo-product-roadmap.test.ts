import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  questionWantsCompareCard,
  questionWantsPeerCompare,
  extractPeerCompareTickers,
} from "@/lib/largo/desk-prompts";
import { extractWatchlistFromText, normalizeWatchlist } from "@/lib/largo/session-metadata";
import { parseLargoDepth, largoDepthConfig } from "@/lib/largo/largo-depth";
import { buildLargoActions } from "@/lib/largo/largo-actions";

describe("desk-prompts", () => {
  it("questionWantsCompareCard detects flow vs gex", () => {
    assert.equal(questionWantsCompareCard("Compare HELIX flow vs Thermal GEX on SPX"), true);
    assert.equal(questionWantsCompareCard("What's SPX at?"), false);
  });

  it("questionWantsPeerCompare detects three-ticker asks", () => {
    assert.equal(
      questionWantsPeerCompare("Compare NVDA vs AMD vs SMH — flow and gamma side by side"),
      true
    );
    assert.equal(questionWantsPeerCompare("Compare HELIX flow vs Thermal GEX on SPX"), false);
    assert.equal(questionWantsCompareCard("Compare HELIX flow vs Thermal GEX on SPX"), true);
  });

  it("extractPeerCompareTickers parses vs chains and defaults", () => {
    assert.deepEqual(extractPeerCompareTickers("NVDA vs AMD vs SMH"), ["NVDA", "AMD", "SMH"]);
    assert.deepEqual(extractPeerCompareTickers("compare three tickers on earnings"), [
      "NVDA",
      "AMD",
      "SMH",
    ]);
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
        kind: "helix_thermal",
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

  it("builds thermal flip from peer compare row", () => {
    const actions = buildLargoActions({
      ticker: "NVDA",
      compareCard: {
        kind: "peer_tickers",
        tickers: ["NVDA", "AMD", "SMH"],
        as_of: "",
        rows: [
          {
            ticker: "NVDA",
            flow: { available: true, bias: "bullish", summary: "" },
            gamma: { available: true, bias: "bullish", summary: "", flip: 920 },
            conflict: false,
            conflict_note: null,
          },
        ],
        peer_divergence: false,
        peer_divergence_note: null,
      },
    });
    assert.ok(actions.some((a) => a.id === "thermal-flip" && a.href.includes("920")));
  });
});
