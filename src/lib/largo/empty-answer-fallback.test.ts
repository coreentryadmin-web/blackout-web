import test from "node:test";
import assert from "node:assert/strict";

import { classifyEmptyAnswer, emptyAnswerFallback } from "./empty-answer-fallback";

/**
 * The fallback blamed the DATA for a TIMEOUT.
 *
 * MEASURED ON PROD 2026-08-20 — three turns in one eight-question adversarial run returned exactly
 * "I couldn't pull enough live data to answer that — try naming a ticker or asking about SPX
 * structure.":
 *
 *     sunday/deep     81.7s   (Deep budget: 75s)
 *     dte3/deep       89.8s
 *     macro/concrete  21.3s
 *
 * None lacked data. They ran out of TIME — and the member was told the desk had no data and advised
 * to "try naming a ticker" on a question that already named SPX. The advice cannot help, because it
 * addresses a cause that was not the cause.
 *
 * Same shape as the vanna fabricated negative: an honest-SOUNDING explanation attached to the wrong
 * reason. A member cannot tell "we have no data" from "this took too long", and only one of those
 * means retry.
 */

test("REGRESSION: a run that burned its budget is reported as a timeout, not missing data", () => {
  const out = emptyAnswerFallback({ elapsedMs: 81_712, budgetMs: 75_000, toolsUsed: ["desk_prefetch_spx"] });
  assert.match(out, /longer than my/i);
  assert.match(out, /75s/, "must name the budget it blew");
  assert.match(out, /82s/, "must name what it actually took");
  assert.doesNotMatch(out, /couldn't pull enough live data/i, "must NOT blame the data");
  assert.doesNotMatch(out, /try naming a ticker/i, "must not give advice that cannot help");
});

test("a genuine data gap still says so", () => {
  // The original message is correct when it IS the cause; this fix narrows it, it does not delete it.
  const out = emptyAnswerFallback({ elapsedMs: 2_000, budgetMs: 75_000, toolsUsed: [] });
  assert.match(out, /couldn't pull enough live data/i);
  assert.match(out, /try naming a ticker/i);
});

test("the 85% threshold catches a loop killed just short of its deadline", () => {
  // A loop stopped at its deadline rarely reports the deadline exactly. Reading a timeout as
  // "no data" sends the member somewhere useless; the reverse merely suggests a retry — so the
  // margin is deliberately generous in the safer direction.
  assert.equal(classifyEmptyAnswer({ elapsedMs: 64_000, budgetMs: 75_000, toolsUsed: [] }), "timeout");
  assert.equal(classifyEmptyAnswer({ elapsedMs: 60_000, budgetMs: 75_000, toolsUsed: [] }), "no_data");
});

test("the threshold is RELATIVE to each mode's budget, not a fixed number of seconds", () => {
  // 26s is a timeout against Concrete's 30s budget and a data gap against Deep's 75s. A single
  // hard-coded second-count would be wrong for one mode or the other.
  assert.equal(classifyEmptyAnswer({ elapsedMs: 26_000, budgetMs: 30_000, toolsUsed: [] }), "timeout");
  assert.equal(classifyEmptyAnswer({ elapsedMs: 26_000, budgetMs: 75_000, toolsUsed: [] }), "no_data");
});

test("an empty answer well inside budget is a DATA gap, not a timeout", () => {
  // Corrects an assumption I made while writing these tests. The prod run showed
  // macro/concrete returning the fallback at 21.3s — and I initially wrote that up as a third
  // timeout. It is not: 21.3s against Concrete's 30s budget is 71%, so the loop finished early and
  // genuinely produced nothing. Widening the threshold to capture it would relabel real data gaps
  // as timeouts and tell members to retry something that will fail again the same way.
  assert.equal(classifyEmptyAnswer({ elapsedMs: 21_300, budgetMs: 30_000, toolsUsed: [] }), "no_data");
  assert.match(
    emptyAnswerFallback({ elapsedMs: 21_300, budgetMs: 30_000, toolsUsed: [] }),
    /couldn't pull enough live data/i
  );
});

test("it suggests the mode that would actually finish", () => {
  const out = emptyAnswerFallback({ elapsedMs: 90_000, budgetMs: 75_000, toolsUsed: [] });
  assert.match(out, /Concrete/, "a timeout on Deep should point at the tighter loop");
});

test("total — a zero or missing budget never crashes and degrades to the data message", () => {
  assert.equal(classifyEmptyAnswer({ elapsedMs: 0, budgetMs: 0, toolsUsed: [] }), "no_data");
  assert.ok(emptyAnswerFallback({ elapsedMs: 0, budgetMs: 0, toolsUsed: [] }).length > 0);
});
