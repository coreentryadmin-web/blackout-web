import { test } from "node:test";
import assert from "node:assert/strict";
import { LARGO_TOOL_DEFS } from "@/lib/largo/tool-defs";
import { largoAiGuide } from "./guides/instruments/largo-ai";
import { LEARN_ARTICLES } from "./articles";

/**
 * Regression for 2026-10-12: three Learn copy locations claimed Largo has "~70+"/"over 70"
 * tools, stale against the real LARGO_TOOL_DEFS registry (138 tools at the time this was found —
 * grown from ~70 without the Learn copy being swept). Asserts a safe FLOOR (130, below today's
 * real count) rather than exact equality — the registry is expected to keep growing, and a floor
 * never needs touching again as long as it stays true; it would only fail if the registry ever
 * shrank far enough to make "over 130" an overstatement, which is the actual failure mode worth
 * catching (promising more tools than Largo really has).
 */
const TOOL_COUNT_FLOOR = 130;

test("LARGO_TOOL_DEFS has at least the floor the Learn copy below promises", () => {
  assert.ok(
    LARGO_TOOL_DEFS.length >= TOOL_COUNT_FLOOR,
    `LARGO_TOOL_DEFS has ${LARGO_TOOL_DEFS.length} tools, below the ${TOOL_COUNT_FLOOR} floor the Learn copy claims`
  );
});

function articleBody(slug: string): string {
  const article = LEARN_ARTICLES.find((a) => a.slug === slug);
  assert.ok(article, `article "${slug}" not found`);
  return article!.body;
}

test("largo-ai guide's tool-count claim does not overstate LARGO_TOOL_DEFS", () => {
  const shows = largoAiGuide.sections
    .filter((s) => s.type === "panels")
    .flatMap((s) => s.panels.flatMap((p) => p.shows))
    .join(" ");
  const match = shows.match(/~(\d+)\+ backend tools/);
  assert.ok(match, "largo-ai guide's tool-count line not found or changed shape");
  assert.ok(
    Number(match![1]) <= LARGO_TOOL_DEFS.length,
    `guide claims ~${match![1]}+ tools, but LARGO_TOOL_DEFS only has ${LARGO_TOOL_DEFS.length}`
  );
});

test("largo-ai-terminal-guide article's tool-count claim does not overstate LARGO_TOOL_DEFS", () => {
  const body = articleBody("largo-ai-terminal-guide");
  const match = body.match(/over \*\*(\d+) tools\*\*/);
  assert.ok(match, "largo-ai-terminal-guide's tool-count line not found or changed shape");
  assert.ok(
    Number(match![1]) <= LARGO_TOOL_DEFS.length,
    `article claims over ${match![1]} tools, but LARGO_TOOL_DEFS only has ${LARGO_TOOL_DEFS.length}`
  );
});

test("largo-ai-market-analysis-tips article's tool-count claim does not overstate LARGO_TOOL_DEFS", () => {
  const body = articleBody("largo-ai-market-analysis-tips");
  const match = body.match(/over \*\*(\d+) live data tools\*\*/);
  assert.ok(match, "largo-ai-market-analysis-tips's tool-count line not found or changed shape");
  assert.ok(
    Number(match![1]) <= LARGO_TOOL_DEFS.length,
    `article claims over ${match![1]} live data tools, but LARGO_TOOL_DEFS only has ${LARGO_TOOL_DEFS.length}`
  );
});
