import test from "node:test";
import assert from "node:assert/strict";
import { classifyLayout, blockOrder, LAYOUT_LABEL, type AnswerLayout } from "./answer-layout";

test("the worked examples classify as specified", () => {
  assert.equal(classifyLayout("Is the 7800 wall holding or breaking on next 0DTE roll?"), "level");
  assert.equal(classifyLayout("Why is SPX dropping?"), "market");
  assert.equal(classifyLayout("META or NVDA?"), "comparison");
  assert.equal(classifyLayout("What are the best trades right now?"), "ranking");
  assert.equal(classifyLayout("What happened to SPX today?"), "recap");
  assert.equal(classifyLayout("Where is the unusual flow?"), "flow");
  assert.equal(
    classifyLayout("What is a good options play to take on NVDA today?"),
    "trade"
  );
  assert.equal(classifyLayout("What could be a good 0DTE play on TSLA?"), "trade");
});

test("a question that is two things at once resolves most-specific-first", () => {
  // Comparison beats level: the shape being asked for is a table, not one level's status.
  assert.equal(classifyLayout("Compare META and NVDA at the 600 level"), "comparison");
  // Ranking beats flow: "best" asks for an ordered set.
  assert.equal(classifyLayout("Best flow setups right now?"), "ranking");
  // Recap beats market: past tense wins over "why".
  assert.equal(classifyLayout("Why did SPX sell off today — what happened?"), "recap");
});

test("a level question REQUIRES a number", () => {
  // With a number it is about that level.
  assert.equal(classifyLayout("Is 7800 holding?"), "level");
  // Without one it is a structure question, not a level question.
  assert.notEqual(classifyLayout("Is the wall holding?"), "level");
});

test("unrecognised questions default — defaulting is not a failure", () => {
  assert.equal(classifyLayout("Tell me about the platform"), "default");
  assert.equal(classifyLayout("hello"), "default");
  assert.equal(classifyLayout(""), "default");
  assert.equal(classifyLayout(null), "default");
  assert.equal(classifyLayout(undefined), "default");
});

test("EVERY layout renders EVERY block — layout reorders, it never drops", () => {
  // This is the safety property the whole module rests on. A classifier WILL misfire; a misfire
  // must cost emphasis, never content.
  const layouts: AnswerLayout[] = ["level", "comparison", "ranking", "recap", "flow", "trade", "market", "default"];
  for (const l of layouts) {
    const order = blockOrder(l);
    assert.deepEqual(
      [...order].sort(),
      ["gexShifts", "invalidation", "ladder", "sections", "signals", "systemReads"],
      `layout ${l} does not render every block exactly once`
    );
    assert.equal(new Set(order).size, order.length, `layout ${l} repeats a block`);
  }
});

test("trade layout leads with interpretation prose, not a signal table", () => {
  assert.equal(blockOrder("trade")[0], "sections");
});

test("each layout leads with the block its question is about", () => {
  assert.equal(blockOrder("level")[0], "ladder");
  assert.equal(blockOrder("flow")[0], "signals");
  assert.equal(blockOrder("comparison")[0], "sections");
  assert.equal(blockOrder("recap")[0], "sections");
});

test("invalidation is last under every layout — it is the stop condition", () => {
  for (const l of Object.keys(LAYOUT_LABEL) as AnswerLayout[]) {
    assert.equal(blockOrder(l).at(-1), "invalidation", l);
  }
});

test("an unknown layout falls back to the default order rather than rendering nothing", () => {
  const order = blockOrder("nonsense" as AnswerLayout);
  assert.deepEqual(order, ["systemReads", "signals", "gexShifts", "ladder", "sections", "invalidation"]);
});

test("every layout has a label", () => {
  for (const l of Object.keys(LAYOUT_LABEL) as AnswerLayout[]) {
    assert.ok(LAYOUT_LABEL[l].length > 0);
  }
});
