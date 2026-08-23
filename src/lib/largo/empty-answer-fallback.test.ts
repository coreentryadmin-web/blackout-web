import test from "node:test";
import assert from "node:assert/strict";

import { classifyEmptyAnswer, emptyAnswerFallback, type LoopStopReason } from "./empty-answer-fallback";

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

test("a tripped spend ceiling outranks BOTH timeout and data-gap and names the real reason", () => {
  // The whole point of the fix: a paused desk must never read as "no data" OR as a timeout. It
  // wins even when the elapsed/budget would otherwise classify as a timeout (a ceiling stop can
  // happen on a long turn) or as a data gap (it can happen early).
  assert.equal(
    classifyEmptyAnswer({ elapsedMs: 70_000, budgetMs: 75_000, toolsUsed: [], ceilingTripped: true }),
    "budget_ceiling"
  );
  assert.equal(
    classifyEmptyAnswer({ elapsedMs: 2_000, budgetMs: 75_000, toolsUsed: [], ceilingTripped: true }),
    "budget_ceiling"
  );
  const out = emptyAnswerFallback({ elapsedMs: 2_000, budgetMs: 75_000, toolsUsed: [], ceilingTripped: true });
  assert.match(out, /temporarily paused/i);
  assert.match(out, /daily AI spend limit/i);
  assert.doesNotMatch(out, /couldn't pull enough live data/i);
});

test("ceilingTripped:false is inert — the existing timeout/no_data logic is unchanged", () => {
  assert.equal(
    classifyEmptyAnswer({ elapsedMs: 64_000, budgetMs: 75_000, toolsUsed: [], ceilingTripped: false }),
    "timeout"
  );
  assert.equal(
    classifyEmptyAnswer({ elapsedMs: 21_300, budgetMs: 30_000, toolsUsed: [], ceilingTripped: false }),
    "no_data"
  );
});

/**
 * ── THE SAME DEFECT, ONE LAYER DEEPER (2026-08-22) ───────────────────────────────────────────
 *
 * The timeout regression above was fixed by measuring elapsed time. This one could not be, because
 * by the time the copy is chosen the ONLY thing left is a bare `null`: `anthropicToolLoop` collapses
 * eight structurally different outcomes into it — closed gate, missing key, spend ceiling, upstream
 * failure, empty model round, exhausted budget, exhausted rounds.
 *
 * MEASURED ON PROD 2026-08-22 — every round-0 Anthropic call was failing with HTTP 400 *"Your credit
 * balance is too low to access the Anthropic API"*, and for a full day Largo answered "I couldn't
 * pull enough live data" to every question, on a desk whose data was fine. Nine sampled turns, both
 * depths, three models (sonnet-5 → sonnet-4-6 escalation, haiku-4-5 → sonnet-4-6), all identical.
 * A billing failure narrated as a data gap, which cost three lanes a day of investigation because
 * the answer could not say what had actually happened.
 *
 * So the loop now REPORTS which exit it took, and these tests hold the two properties that matter:
 * a stated reason outranks the elapsed-time guess, and only a genuine data gap may say "no data".
 */

test("REGRESSION: an upstream provider failure is never narrated as missing data", () => {
  const out = emptyAnswerFallback({
    elapsedMs: 3_546,
    budgetMs: 30_000,
    toolsUsed: ["live_feed_capture", "platform_vitals_prefetch"],
    stopReason: "upstream_error",
  });
  assert.doesNotMatch(out, /couldn't pull enough live data/i, "the exact string that shipped the defect");
  assert.doesNotMatch(out, /naming a ticker/i, "advice that cannot help — the cause is not the data");
  assert.match(out, /provider/i, "must name what actually failed");
  assert.match(out, /not a gap in the desk's data/i, "must say plainly that the data was fine");
});

test("the provider message NEVER reaches the member — it can name our billing state", () => {
  const out = emptyAnswerFallback({
    elapsedMs: 900,
    budgetMs: 30_000,
    toolsUsed: [],
    stopReason: "upstream_error",
  });
  assert.doesNotMatch(out, /credit/i);
  assert.doesNotMatch(out, /balance/i);
  assert.doesNotMatch(out, /\b400\b/);
  assert.doesNotMatch(out, /anthropic/i);
});

test("A STATED REASON OUTRANKS THE ELAPSED-TIME GUESS — a fact must never lose to a heuristic", () => {
  // Elapsed is past the 85% timeout threshold, which alone would classify "timeout". The loop said
  // the upstream failed, and that is what actually happened.
  assert.equal(
    classifyEmptyAnswer({ elapsedMs: 70_000, budgetMs: 75_000, toolsUsed: [], stopReason: "upstream_error" }),
    "provider_error"
  );
  // ...and the converse: a fast failure that the heuristic would call "no_data".
  assert.equal(
    classifyEmptyAnswer({ elapsedMs: 900, budgetMs: 75_000, toolsUsed: [], stopReason: "upstream_error" }),
    "provider_error"
  );
});

test("every loop stop reason maps to its own cause", () => {
  const cases = [
    ["spend_ceiling", "budget_ceiling"],
    ["upstream_error", "provider_error"],
    ["ai_disabled", "unavailable"],
    ["not_configured", "unavailable"],
    ["empty_round", "empty_round"],
    ["loop_budget", "timeout"],
  ] as const;
  for (const [reason, expected] of cases) {
    assert.equal(
      classifyEmptyAnswer({ elapsedMs: 1_000, budgetMs: 75_000, toolsUsed: [], stopReason: reason }),
      expected,
      `${reason} must classify as ${expected}`
    );
  }
});

test("ONLY a genuine data gap may say 'no data' — every other cause must not", () => {
  const reasons = [
    "spend_ceiling",
    "upstream_error",
    "ai_disabled",
    "not_configured",
    "empty_round",
    "loop_budget",
  ] as const;
  for (const stopReason of reasons) {
    const out = emptyAnswerFallback({ elapsedMs: 2_000, budgetMs: 75_000, toolsUsed: [], stopReason });
    assert.doesNotMatch(
      out,
      /couldn't pull enough live data/i,
      `${stopReason} must not be narrated as a data gap`
    );
  }
});

test("an empty round says the data was not the problem, without narrating machinery", () => {
  const out = emptyAnswerFallback({ elapsedMs: 4_000, budgetMs: 75_000, toolsUsed: [], stopReason: "empty_round" });
  assert.match(out, /came back empty/i);
  assert.match(out, /isn't a gap in the desk's data/i);
  // A member does not know what a model, a tool call or a prefetch is — the vocabulary that reached
  // member prose in the defect `never-narrate-machinery.test.ts` was written for.
  for (const noun of [/\bthe model\b/i, /\btool\b/i, /\bprefetch\b/i, /\bAPI\b/i]) {
    assert.doesNotMatch(out, noun, `internal vocabulary reached member copy: ${noun}`);
  }
});

test("BACK-COMPAT: with no stopReason the classification is exactly what it was", () => {
  assert.equal(classifyEmptyAnswer({ elapsedMs: 81_712, budgetMs: 75_000, toolsUsed: [] }), "timeout");
  assert.equal(classifyEmptyAnswer({ elapsedMs: 21_300, budgetMs: 30_000, toolsUsed: [] }), "no_data");
  assert.equal(
    classifyEmptyAnswer({ elapsedMs: 1_000, budgetMs: 75_000, toolsUsed: [], ceilingTripped: true }),
    "budget_ceiling"
  );
  // "answered" and "max_rounds" deliberately carry no more information than the heuristic does.
  assert.equal(
    classifyEmptyAnswer({ elapsedMs: 21_300, budgetMs: 30_000, toolsUsed: [], stopReason: "max_rounds" }),
    "no_data"
  );
});

/**
 * THE UNION IS DECLARED ONCE — and this test is what is left of the guard that tried to police two.
 *
 * The first version of this fix duplicated the union into empty-answer-fallback.ts and pinned the
 * copies with a type-level assertion here. It was INERT: `tsconfig.json` excludes `**\/*.test.ts`,
 * so `tsc` never type-checks this file. Proven by adding a member to one union and watching the
 * build stay green — the guard could not have fired for any drift, ever.
 *
 * Worth stating plainly for the next person: **a compile-time assertion written in a `*.test.ts`
 * file in this repo does nothing.** Put it in a checked source file, or make it a runtime test.
 *
 * The duplicate was deleted rather than re-guarded, so drift is now impossible by construction:
 * `providers/anthropic` owns `ToolLoopStopReason`, this module imports it type-only. What remains
 * worth testing is the thing that would still rot silently — a reason the `switch` forgets, which
 * falls through to "no_data" and reinstates the defect.
 */

test("every stop reason the loop can emit is handled — a forgotten one falls through to 'no data'", () => {
  const everyReason: LoopStopReason[] = [
    "answered",
    "ai_disabled",
    "not_configured",
    "spend_ceiling",
    "upstream_error",
    "empty_round",
    "loop_budget",
    "max_rounds",
  ];
  // "answered" and "max_rounds" legitimately fall through to the heuristics; every OTHER reason
  // must be explicitly classified, because each names a cause that is not a data gap.
  const mustNotBeNoData = everyReason.filter((r) => r !== "answered" && r !== "max_rounds");
  for (const stopReason of mustNotBeNoData) {
    assert.notEqual(
      classifyEmptyAnswer({ elapsedMs: 2_000, budgetMs: 75_000, toolsUsed: [], stopReason }),
      "no_data",
      `${stopReason} fell through to no_data — add it to the switch in classifyEmptyAnswer`
    );
  }
});
