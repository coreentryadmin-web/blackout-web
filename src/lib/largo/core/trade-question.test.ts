import test from "node:test";
import assert from "node:assert/strict";
import {
  isTradeRecommendationQuestion,
  formatTradeAnswerBlock,
  formatEvidenceOntologyBlock,
} from "./trade-question";

test("isTradeRecommendationQuestion detects options-play asks", () => {
  assert.equal(
    isTradeRecommendationQuestion("What is a good options play to take on NVDA today?"),
    true
  );
  assert.equal(isTradeRecommendationQuestion("Should I buy NVDA calls?"), true);
  assert.equal(isTradeRecommendationQuestion("What is the play on SPX?"), true);
  assert.equal(isTradeRecommendationQuestion("Why is NVDA dropping?"), false);
  assert.equal(isTradeRecommendationQuestion("Where is the flow?"), false);
});

test("formatTradeAnswerBlock includes entity ontology reminders", () => {
  const block = formatTradeAnswerBlock("NVDA");
  assert.match(block, /NO CLEAN FRESH ENTRY YET/);
  assert.match(block, /FLOW_STRIKE ≠ PUT_WALL/);
  assert.match(block, /Night Hawk \*\*evening edition\*\*/);
});

test("formatEvidenceOntologyBlock lists typed level entities", () => {
  const block = formatEvidenceOntologyBlock();
  assert.match(block, /GAMMA_FLIP/);
  assert.match(block, /Horizon.*0DTE/);
});
