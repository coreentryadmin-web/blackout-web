import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseExplainSections, convictionFillPct } from "./play-briefing-utils.ts";

describe("play-briefing-utils", () => {
  it("convictionFillPct maps grades", () => {
    assert.equal(convictionFillPct("A+"), 100);
    assert.equal(convictionFillPct("B"), 68);
  });

  it("parseExplainSections splits bold headers", () => {
    const text = "**Why ranked #1**\nFlow was one-sided.\n**Bottom line:** Hold above entry.";
    const sections = parseExplainSections(text);
    assert.equal(sections.length, 2);
    assert.equal(sections[0].title, "Why ranked #1");
    assert.match(sections[0].body, /one-sided/);
    assert.equal(sections[1].title, "Bottom line:");
  });
});
