import { test } from "node:test";
import assert from "node:assert/strict";
import {
  THESIS_EVIDENCE_MAX_TICKERS_DEFAULT,
  selectThesisEvidenceTickers,
  thesisEvidenceMaxTickers,
} from "./evidence-bundle-map";

test("thesisEvidenceMaxTickers defaults to 24", () => {
  const prev = process.env.ZERODTE_THESIS_EVIDENCE_MAX_TICKERS;
  delete process.env.ZERODTE_THESIS_EVIDENCE_MAX_TICKERS;
  assert.equal(thesisEvidenceMaxTickers(), THESIS_EVIDENCE_MAX_TICKERS_DEFAULT);
  process.env.ZERODTE_THESIS_EVIDENCE_MAX_TICKERS = "12";
  assert.equal(thesisEvidenceMaxTickers(), 12);
  if (prev != null) process.env.ZERODTE_THESIS_EVIDENCE_MAX_TICKERS = prev;
  else delete process.env.ZERODTE_THESIS_EVIDENCE_MAX_TICKERS;
});

test("selectThesisEvidenceTickers dedupes and caps", () => {
  const tickers = ["nvda", "NVDA", "TSLA", "AAPL", "META", "AMD", "INTC"];
  assert.deepEqual(selectThesisEvidenceTickers(tickers, 3), ["NVDA", "TSLA", "AAPL"]);
});
