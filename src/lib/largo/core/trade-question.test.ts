import test from "node:test";
import assert from "node:assert/strict";
import {
  isTradeRecommendationQuestion,
  isZeroDtePlayQuestion,
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

test("isZeroDtePlayQuestion detects same-day play asks", () => {
  assert.equal(isZeroDtePlayQuestion("What could be a good 0DTE play on TSLA?"), true);
  assert.equal(isZeroDtePlayQuestion("Any 0dte setup for NVDA today?"), true);
  assert.equal(isZeroDtePlayQuestion("Why is NVDA dropping?"), false);
  assert.equal(
    isZeroDtePlayQuestion("What is a good options play to take on NVDA today?"),
    false
  );
});

test("formatTradeAnswerBlock includes empty-board synthesis rules", () => {
  const block = formatTradeAnswerBlock("NVDA");
  assert.match(block, /NO open play/);
  assert.match(block, /NOT ON 0DTE BOARD/);
  assert.match(block, /FLOW_STRIKE ≠ PUT_WALL/);
});

test("formatEvidenceOntologyBlock lists typed level entities", () => {
  const block = formatEvidenceOntologyBlock();
  assert.match(block, /GAMMA_FLIP/);
  assert.match(block, /Horizon.*0DTE/);
});
