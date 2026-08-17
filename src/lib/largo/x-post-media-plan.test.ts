import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildXPostMediaPlan, formatMediaPlanForClipboard } from "./x-post-media-plan";

describe("buildXPostMediaPlan", () => {
  it("prioritizes Helix + Thermal when flow and GEX dominate", () => {
    const plan = buildXPostMediaPlan({
      ticker: "NVDA",
      answer:
        "## Verdict\nBearish — Helix shows net put premium and Thermal has spot below gamma flip.",
    });
    const tools = plan.map((p) => p.tool);
    assert.ok(tools.includes("Helix"));
    assert.ok(tools.includes("Thermal"));
    assert.ok(!tools.includes("SPX Slayer"));
    assert.ok(plan.length <= 4);
  });

  it("includes SPX Slayer on SPX posts when play engine is discussed", () => {
    const plan = buildXPostMediaPlan({
      ticker: "SPX",
      answer: "SPX Slayer play engine is in WATCH — confluence grade B, flip at 5800.",
    });
    assert.ok(plan.some((p) => p.tool === "SPX Slayer"));
  });

  it("defaults to vector/helix/thermal/largo for generic NVDA read", () => {
    const plan = buildXPostMediaPlan({
      ticker: "NVDA",
      answer: "## Verdict\nNeutral — no strong edge.",
    });
    assert.equal(plan.length, 4);
    assert.ok(plan[0]?.primary);
  });

  it("formats clipboard attachment block", () => {
    const plan = buildXPostMediaPlan({ ticker: "SPX", answer: "flow and gex" });
    const block = formatMediaPlanForClipboard(plan);
    assert.match(block, /Screenshot workflow \(4 panels/);
    assert.match(block, /\/heatmap/);
  });
});
