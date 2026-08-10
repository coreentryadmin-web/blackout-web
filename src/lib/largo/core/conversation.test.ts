import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildConversationContext,
  applyConversationToTimeframe,
  effectiveEntities,
  formatConversationBlock,
  referencesLastExchange,
} from "./conversation";
import { resolveTimeframe } from "@/lib/largo/temporal/timeframe";

const KNOWN = new Set(["SPX", "SPY", "NVDA", "TSLA", "AMD", "VIX", "META"]);
const ctxOf = (question: string, previousQuestion: string | null, askedAtMs: number | null = null) =>
  buildConversationContext({ question, previousQuestion, previousAskedAtMs: askedAtMs, known: KNOWN });

test("the first turn of a session is never a follow-up", () => {
  // Nothing to continue. Classifying it as one would carry a subject from a session that does
  // not exist.
  const c = ctxOf("what about puts?", null);
  assert.equal(c.isFollowUp, false);
  assert.deepEqual(c.carried, []);
  assert.equal(formatConversationBlock(c), "");
});

test("a self-contained question is not a follow-up even mid-session", () => {
  // The asymmetry that governs this module: misreading a fresh question as a continuation imports
  // a stale subject, which is far worse than planning broadly.
  const c = ctxOf("where are the dealer gamma walls on TSLA", "how is NVDA flow today");
  assert.equal(c.isFollowUp, false);
  assert.deepEqual(c.entities.map((e) => e.key), ["TSLA"]);
  assert.deepEqual(c.carried, [], "a question that named its own subject inherits nothing");
});

test("continuation openers are recognised", () => {
  for (const q of ["and puts?", "what about the downside", "why?", "how about tomorrow", "also the wall"]) {
    assert.equal(ctxOf(q, "how is NVDA flow today").isFollowUp, true, q);
  }
});

test("a bare pronoun with no subject is a follow-up; a pronoun WITH one is not", () => {
  assert.equal(ctxOf("is it still holding", "how is NVDA flow today").isFollowUp, true);
  // "is it above the TSLA wall" has its antecedent in the sentence — nothing to inherit.
  const own = ctxOf("is it above the TSLA wall", "how is NVDA flow today");
  assert.deepEqual(own.carried, [], "a named subject must never be overridden by a stale one");
  assert.deepEqual(effectiveEntities(own).map((e) => e.key), ["TSLA"]);
});

test("the subject is carried forward ONLY into a vacuum", () => {
  const c = ctxOf("and puts?", "how is NVDA flow today");
  assert.deepEqual(c.entities, [], "the question itself names nothing");
  assert.deepEqual(c.carried.map((e) => e.key), ["NVDA"]);
  assert.deepEqual(effectiveEntities(c).map((e) => e.key), ["NVDA"]);

  const named = ctxOf("and what about SPY?", "how is NVDA flow today");
  assert.deepEqual(named.carried, []);
  assert.deepEqual(effectiveEntities(named).map((e) => e.key), ["SPY"]);
});

test("a carried subject is declared as an assumption, not applied silently", () => {
  // The recovery path. "Assuming you still mean NVDA" is correctable by the member; an answer that
  // just talks about NVDA is not.
  const block = formatConversationBlock(ctxOf("and puts?", "how is NVDA flow today"));
  assert.match(block, /carried forward: NVDA/);
  assert.match(block, /State that assumption/);
  assert.match(block, /previous question was: "how is NVDA flow today"/);
});

test("referencesLastExchange catches the phrasings members actually use", () => {
  for (const q of [
    "what changed since I last asked",
    "anything different since my last question",
    "since we last spoke, did SPX move",
    "since asked, what moved",
  ]) {
    assert.equal(referencesLastExchange(q), true, q);
  }
  assert.equal(referencesLastExchange("what changed since the open"), false);
  assert.equal(referencesLastExchange(""), false);
});

test('"since I last asked" gets a REAL window start from conversation state', () => {
  // This is the gap the temporal layer left open with `fromMs: null // filled by the caller from
  // conversation state`. Nothing filled it, so the one exactly-answerable temporal question
  // resolved to an unbounded window.
  const now = Date.UTC(2026, 7, 10, 18, 0, 0);
  const asked = now - 15 * 60_000;
  const raw = resolveTimeframe("what changed since I last asked", now);
  assert.equal(raw.fromMs, null, "unfilled, this is the bug");

  const filled = applyConversationToTimeframe(raw, ctxOf("what changed since I last asked", "how is SPX", asked));
  assert.equal(filled.fromMs, asked);
  assert.equal(filled.toMs, now);
  assert.match(filled.label, /since your last question/);
});

test("an unknown previous-turn time leaves the window unresolved rather than inventing one", () => {
  const now = Date.UTC(2026, 7, 10, 18, 0, 0);
  const raw = resolveTimeframe("what changed since I last asked", now);
  const unfilled = applyConversationToTimeframe(raw, ctxOf("what changed since I last asked", "how is SPX", null));
  assert.equal(unfilled.fromMs, null, "no timestamp means no window — the model is told to say so");
  assert.equal(unfilled.label, raw.label);
});

test("a nonsensical timestamp is rejected instead of producing a negative window", () => {
  const now = Date.UTC(2026, 7, 10, 18, 0, 0);
  const raw = resolveTimeframe("what changed since I last asked", now);
  // A previous turn "in the future" is corrupt data, not a window.
  const future = applyConversationToTimeframe(raw, ctxOf("x", "how is SPX", now + 60_000));
  assert.equal(future.fromMs, null);
  const nan = applyConversationToTimeframe(raw, ctxOf("x", "how is SPX", NaN));
  assert.equal(nan.fromMs, null);
});

test("a timeframe that already has a start is never rewritten", () => {
  // Conversation state fills a HOLE. It must not override an explicit window the member gave.
  const now = Date.UTC(2026, 7, 10, 18, 0, 0);
  const explicit = resolveTimeframe("what happened in the last 30 minutes", now);
  assert.ok(explicit.fromMs != null, "fixture must have a resolved start");
  const after = applyConversationToTimeframe(explicit, ctxOf("x", "y", now - 5 * 60_000));
  assert.equal(after.fromMs, explicit.fromMs);
  assert.equal(after.label, explicit.label);
});

test("a present-tense question is untouched by conversation state", () => {
  const now = Date.UTC(2026, 7, 10, 18, 0, 0);
  const live = resolveTimeframe("where is SPX", now);
  assert.equal(live.historical, false);
  const after = applyConversationToTimeframe(live, ctxOf("where is SPX", "how is NVDA", now - 60_000));
  assert.deepEqual(after, live, "a live question must not acquire a window from the conversation");
});

test("the block reports a missing timestamp as missing", () => {
  const block = formatConversationBlock(ctxOf("what changed since I last asked", "how is SPX", null));
  assert.match(block, /not recorded/);
  assert.match(block, /say so rather than assuming one/);
});

test("the block is empty on a standalone question — most turns pay nothing", () => {
  assert.equal(formatConversationBlock(ctxOf("where are the SPX gamma walls", "how is NVDA flow")), "");
  assert.equal(formatConversationBlock(ctxOf("hello", null)), "");
});

test("everything is total — no input throws", () => {
  assert.doesNotThrow(() => ctxOf("", ""));
  assert.doesNotThrow(() => ctxOf("x".repeat(5000), "y".repeat(5000), 0));
  assert.doesNotThrow(() => formatConversationBlock(ctxOf("and?", "$".repeat(400))));
  // A very long previous question is truncated, not echoed whole into the prompt.
  const block = formatConversationBlock(ctxOf("and?", "NVDA " + "z".repeat(1000)));
  assert.ok(block.length < 1200, `block was ${block.length} chars`);
});
