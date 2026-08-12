import test from "node:test";
import assert from "node:assert/strict";
import {
  isZeroDtePlayQuestion,
  isPlayQuestion,
  formatTradeAnswerBlock,
  formatEvidenceOntologyBlock,
} from "./trade-question";

test("isPlayQuestion covers trade and 0DTE asks", () => {
  assert.equal(isPlayQuestion("What is a good options play on NVDA?"), true);
  assert.equal(isPlayQuestion("What could be a good 0DTE play on TSLA?"), true);
  assert.equal(isPlayQuestion("Why is NVDA dropping?"), false);
});

test("isZeroDtePlayQuestion detects same-day play asks", () => {
  assert.equal(isZeroDtePlayQuestion("What could be a good 0DTE play on TSLA?"), true);
  assert.equal(isZeroDtePlayQuestion("Why is NVDA dropping?"), false);
});

test("formatTradeAnswerBlock asks for question-specific verdict not fixed template", () => {
  const block = formatTradeAnswerBlock("NVDA");
  assert.match(block, /answer THIS question/i);
  assert.match(block, /do not paste a generic template/i);
  assert.doesNotMatch(block, /NO CLEAN FRESH ENTRY YET/);
});

test("formatEvidenceOntologyBlock lists typed level entities", () => {
  const block = formatEvidenceOntologyBlock();
  assert.match(block, /GAMMA_FLIP/);
});
