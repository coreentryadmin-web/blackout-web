import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applicableProductsForTicker,
  buildTickerSocialGuide,
  extractSocialPostTicker,
} from "./ticker-social-guide";
import { detectSocialArchetype } from "./social-content-core";
import { questionWantsSocialContentPack } from "./desk-prompts";

describe("questionWantsSocialContentPack", () => {
  it("matches generate post phrasing", () => {
    assert.equal(questionWantsSocialContentPack("Generate me a post for NVDA"), true);
  });
});

describe("extractSocialPostTicker", () => {
  it("extracts NVDA from generate post asks", () => {
    assert.equal(extractSocialPostTicker("Generate me a post for NVDA"), "NVDA");
    assert.equal(extractSocialPostTicker("post for $TSLA about flow"), "TSLA");
  });

  it("does not treat today's as a ticker", () => {
    assert.equal(
      extractSocialPostTicker("Draft X post about today's winning 0DTE plays"),
      null,
    );
  });
});

describe("detectSocialArchetype", () => {
  it("detects ticker_post", () => {
    assert.equal(detectSocialArchetype("Generate me a post for NVDA"), "ticker_post");
  });

  it("prefers win_recap over ticker_post for winner asks", () => {
    assert.equal(
      detectSocialArchetype("Draft X post about today's winning 0DTE plays"),
      "win_recap",
    );
  });

  it("detects SPX session read as live_desk not ticker_post", () => {
    assert.equal(
      detectSocialArchetype(
        "Draft an X post for the current SPX setup — flip, walls, flow vs gamma",
      ),
      "live_desk",
    );
  });
});

describe("buildTickerSocialGuide", () => {
  it("includes Vector Helix Thermal for NVDA", () => {
    const guide = buildTickerSocialGuide({ ticker: "NVDA", question: "post for NVDA" });
    const tools = guide.products.map((p) => p.tool);
    assert.ok(tools.includes("Vector"));
    assert.ok(tools.includes("Helix"));
    assert.ok(tools.includes("Thermal"));
    assert.ok(!tools.includes("SPX Slayer"));
    assert.ok(guide.essentialAttachments.length >= 3);
  });

  it("includes SPX Slayer for SPX", () => {
    const products = applicableProductsForTicker("SPX");
    assert.ok(products.some((p) => p.tool === "SPX Slayer"));
  });
});
