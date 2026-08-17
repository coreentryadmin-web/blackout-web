import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatLargoXPost, stripMarkdownForTweet } from "./format-x-post";

describe("stripMarkdownForTweet", () => {
  it("removes headers and bold", () => {
    const out = stripMarkdownForTweet("## Verdict\n**Bearish** below flip at $5800.");
    assert.match(out, /Bearish below flip/);
    assert.doesNotMatch(out, /##/);
    assert.doesNotMatch(out, /\*\*/);
  });
});

describe("formatLargoXPost", () => {
  it("builds tweet from verdict + levels under 280 chars", () => {
    const draft = formatLargoXPost({
      answer: `## Verdict\nBearish — spot below gamma flip with dealers short gamma.\n\n## Data\nFlip from Thermal.`,
      headline: "SPX below flip",
      ticker: "SPX",
      levels: [
        { label: "flip", price: 5800 },
        { label: "call wall", price: 5850 },
      ],
    });
    assert.ok(draft.charCount <= 280);
    assert.match(draft.text, /@BlackOutTrade$/);
    assert.match(draft.text, /SPX/);
    assert.match(draft.text, /flip \$5800/);
    assert.ok(draft.intentUrl.startsWith("https://x.com/intent/tweet?text="));
    assert.ok(Array.isArray(draft.attachments));
    assert.ok(draft.attachments.length >= 1);
    assert.match(draft.clipboardText, /Attach/);
  });

  it("strips vendor names from the body", () => {
    const draft = formatLargoXPost({
      answer: "## Verdict\nNVDA holding resistance — flow tape shows net call premium (Unusual Whales).",
      ticker: "NVDA",
    });
    assert.doesNotMatch(draft.text, /Unusual Whales/i);
    assert.match(draft.text, /flow tape/i);
  });

  it("truncates long answers", () => {
    const long = "A".repeat(400);
    const draft = formatLargoXPost({ answer: `## Verdict\n${long}` });
    assert.ok(draft.charCount <= 280);
    assert.equal(draft.truncated, true);
    assert.equal(draft.archetype, "live_desk");
  });

  it("prefers Post Copy section when Largo authored it", () => {
    const draft = formatLargoXPost({
      answer: `## Verdict\nBearish below flip.\n\n## Post\n**Copy**\nNVDA puts paid — desk caught the flush at the wall. What's your exit rule?\n\n**Alt hooks**\n- Flow turned before price\n- Dealers short gamma into the print\n\n**Attach**\n1. Helix — /flows`,
      ticker: "NVDA",
    });
    assert.match(draft.text, /NVDA puts paid/);
    assert.ok(draft.altHooks.length >= 1);
  });
});
