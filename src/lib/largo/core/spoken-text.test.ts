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

// ---------------------------------------------------------------------------
// HARDENING PASS — the vocabulary a real member actually dictates.
// ---------------------------------------------------------------------------

test("repairs the company names speech models transcribe as English", () => {
  const cases: Array<[string, string]> = [
    ["what is in video doing", "what is NVDA doing"],
    ["en video flow", "NVDA flow"],
    ["and video calls", "NVDA calls"],
    ["how is nvidia today", "how is NVDA today"],
    ["tesla puts", "TSLA puts"],
    ["apple earnings", "AAPL earnings"],
    ["palantir setup", "PLTR setup"],
    ["micro strategy flow", "MSTR flow"],
    ["advanced micro devices", "AMD"],
    ["jp morgan levels", "JPM levels"],
  ];
  for (const [input, want] of cases) assert.equal(normalizeSpokenQuestion(input), want, input);
});

test("repairs index and ETF nicknames", () => {
  assert.equal(normalizeSpokenQuestion("S and P 500 levels"), "SPX levels");
  assert.equal(normalizeSpokenQuestion("S&P levels"), "SPX levels");
  assert.equal(normalizeSpokenQuestion("triple q's"), "QQQ");
  assert.equal(normalizeSpokenQuestion("russell 2000"), "IWM");
  assert.equal(normalizeSpokenQuestion("where is the vix"), "where is VIX");
});

test("repairs 0DTE however it comes back", () => {
  for (const said of [
    "any zero d t e plays",
    "any zero dte plays",
    "any o d t e plays",
    "any oh d t e plays",
    "any zero day to expiry plays",
    "any zero days to expiration plays",
  ]) {
    assert.equal(normalizeSpokenQuestion(said), "any 0DTE plays", said);
  }
});

test("repairs buy/sell homophones ONLY in front of something tradable", () => {
  assert.equal(normalizeSpokenQuestion("should I by calls"), "should I buy calls");
  assert.equal(normalizeSpokenQuestion("by the dip"), "buy the dip");
  assert.equal(normalizeSpokenQuestion("cell puts now"), "sell puts now");
  assert.equal(normalizeSpokenQuestion("cell half"), "sell half");
  // The anchor is the whole point — ordinary English uses of "by" must survive untouched.
  for (const q of [
    "close by tomorrow",
    "by the way what is SPX",
    "written by the desk",
    "a cell in the spreadsheet",
    "stem cell research",
  ]) {
    assert.equal(normalizeSpokenQuestion(q), q, q);
  }
});

test("uppercases desk acronyms said as words and spelled out", () => {
  assert.equal(normalizeSpokenQuestion("where is the gex"), "where is the GEX");
  assert.equal(normalizeSpokenQuestion("show me vwap and rsi"), "show me VWAP and RSI");
  assert.equal(normalizeSpokenQuestion("vee wap level"), "VWAP level");
  assert.equal(normalizeSpokenQuestion("o t m calls"), "OTM calls");
  assert.equal(normalizeSpokenQuestion("check o i per strike"), "check OI per strike");
  assert.equal(normalizeSpokenQuestion("p and l today"), "P&L today");
});

test("strips thinking filler without touching real words", () => {
  assert.equal(normalizeSpokenQuestion("um what is uh SPX doing"), "what is SPX doing");
  // "hum" and "summer" contain filler substrings — the word anchors must protect them.
  assert.equal(normalizeSpokenQuestion("hum a tune in summer"), "hum a tune in summer");
});

test("REGRESSION GUARD: ordinary English is never turned into an instrument", () => {
  // Each of these contains a real symbol as a word or substring. None is about a stock. This is
  // the test that fails first if a future rule is written too loosely.
  const untouched = [
    "I need a break from this",
    "show me all the open plays",
    "what should I do right now",
    "is it on or off",
    "hold it for a bit",
    "gains and profits this week",
    "he sat in the front row",
    "that is a key level so be careful",
    "the cat is on the mat",
    "arm the alert please",
    "put the hood down",
    "flip a coin",
    "gold is not a ticker here",
    "an all time high",
    "I have one more question",
  ];
  for (const q of untouched) assert.equal(normalizeSpokenQuestion(q), q, q);
});

test("a full dictated sentence survives end to end", () => {
  assert.equal(
    normalizeSpokenQuestion("um should I by calls on in video for zero d t e or wait for the gex flip"),
    "should I buy calls on NVDA for 0DTE or wait for the GEX flip"
  );
  assert.equal(
    normalizeSpokenQuestion("what is the S and P 500 doing near vee wap right now"),
    "what is the SPX doing near VWAP right now"
  );
});
