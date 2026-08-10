import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSpokenQuestion } from "./spoken-text";
import { analyzeLargoQuestion } from "@/lib/largo/question-intent";

const tickerOf = (q: string) => analyzeLargoQuestion(q, []).tickerHint;

test("repairs the homophones a speech model actually produces", () => {
  assert.equal(normalizeSpokenQuestion("what is in video doing"), "what is NVDA doing");
  assert.equal(normalizeSpokenQuestion("show me the S and P 500 levels"), "show me the SPX levels");
  assert.equal(normalizeSpokenQuestion("any zero d t e plays"), "any 0DTE plays");
  assert.equal(normalizeSpokenQuestion("how is tesla trading"), "how is TSLA trading");
});

test("collapses a spelled-out symbol only when it is a real ticker", () => {
  assert.equal(normalizeSpokenQuestion("look at T S L A"), "look at TSLA");
  assert.equal(normalizeSpokenQuestion("Q Q Q gamma"), "QQQ gamma");
  // Not a ticker — three letters said aloud must stay three letters.
  assert.equal(normalizeSpokenQuestion("he gave me an I O U"), "he gave me an I O U");
});

test("ordinary speech is never rewritten into an instrument", () => {
  // The whole point of the KNOWN_TICKERS gate and the word anchors: these all contain a substring
  // that is a valid symbol (BRK, ALL, NOW, ON, IT, A) and none of them is about a stock.
  const untouched = [
    "I need a break from this",
    "show me all the open plays",
    "what should I do right now",
    "is it on or off",
    "hold it for a bit",
    "gains and profits this week",
  ];
  for (const q of untouched) assert.equal(normalizeSpokenQuestion(q), q);
});

test("tidies speech-API spacing without changing words", () => {
  assert.equal(normalizeSpokenQuestion("  what   is   the   plan  "), "what is the plan");
  assert.equal(normalizeSpokenQuestion(""), "");
});

test("repaired transcripts route to the ticker the member actually said", () => {
  // The reason this module exists: raw, extractTicker finds nothing (or the wrong thing) and the
  // question is answered about an instrument nobody named.
  assert.equal(tickerOf(normalizeSpokenQuestion("what is in video doing today")), "NVDA");
  assert.equal(tickerOf(normalizeSpokenQuestion("T S L A flow right now")), "TSLA");
});
