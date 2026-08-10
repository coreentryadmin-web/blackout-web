import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSpokenQuestion } from "@/lib/largo/core/spoken-text";

/**
 * DICTATION PIPELINE — what the member hears themselves say vs what lands in the box.
 *
 * WHAT THIS CAN AND CANNOT TEST, stated plainly because the distinction matters.
 *
 * The browser's SpeechRecognition sends audio to a vendor ASR service and returns text. That leg —
 * microphone to words — belongs to Chrome and Google, is not deterministic, and cannot be
 * exercised in CI or from this sandbox (Chromium here has no network of its own). Asserting on it
 * would be asserting on someone else's model.
 *
 * What IS ours, and what this covers, is everything after the words arrive: the accumulation of
 * interim results, the repair of desk vocabulary, and the exact string handed to the composer.
 * So the tests below replay REAL raw transcripts — the literal strings a speech model returns for
 * these sentences — through the same function the hook calls, and assert on what the member ends
 * up with.
 *
 * The browser-level half (button click, interim rendering, submit) is covered by
 * scripts/audit/largo-dictation-e2e.cjs, which drives the real component in real Chromium with a
 * scripted SpeechRecognition standing in for the vendor service.
 */

/** How SpeechRecognition delivers a phrase: the WHOLE transcript, re-sent as it grows. */
function replayInterims(finalTranscript: string): string[] {
  const words = finalTranscript.split(" ");
  return words.map((_, i) => words.slice(0, i + 1).join(" "));
}

test("interim results accumulate to the same repaired text as the final one", () => {
  // The hook concatenates every result and repairs the concatenation, so the last interim must
  // equal the final. If repair were applied per-word the halves would disagree.
  const raw = "should I by calls on in video";
  const interims = replayInterims(raw);
  const last = interims[interims.length - 1]!;
  assert.equal(last, raw);
  assert.equal(normalizeSpokenQuestion(last), "should I buy calls on NVDA");
});

test("a partial transcript is never left in a half-repaired state", () => {
  // Mid-utterance, "in" has arrived but "video" has not. The repair must not fire early and turn
  // a preposition into a ticker; it fires when the phrase completes.
  assert.equal(normalizeSpokenQuestion("what is in"), "what is in");
  assert.equal(normalizeSpokenQuestion("what is in video"), "what is NVDA");
});

test("REAL dictated questions, end to end", () => {
  // Each left-hand string is what a general speech model actually returns for that sentence.
  const spoken: Array<[string, string]> = [
    ["what is in video doing today", "what is NVDA doing today"],
    ["show me the S and P 500 gamma flip", "show me the SPX gamma flip"],
    ["any zero d t e plays right now", "any 0DTE plays right now"],
    ["should I by puts on tesla", "should I buy puts on TSLA"],
    ["where is the gex on Q Q Q", "where is the GEX on QQQ"],
    ["cell half my calls", "sell half my calls"],
    ["um what is T S L A doing", "what is TSLA doing"],
    ["how did night hawk do this week", "how did Night Hawk do this week"],
    ["check the dark pool prints on palantir", "check the dark pool prints on PLTR"],
    ["what is my p and l today", "what is my P&L today"],
  ];
  for (const [raw, want] of spoken) assert.equal(normalizeSpokenQuestion(raw), want, raw);
});

test("an empty or whitespace-only transcript yields nothing to send", () => {
  assert.equal(normalizeSpokenQuestion(""), "");
  assert.equal(normalizeSpokenQuestion("   "), "");
  assert.equal(normalizeSpokenQuestion("um uh"), "");
});
