import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TOOL_ROUND_BUDGET_EXCEEDED, raceToolRoundAgainstBudget } from "@/lib/providers/anthropic";

/**
 * ROUND-LEVEL tool-fan-out deadline (2026-10-18 Largo deep-mode burst-latency fix).
 *
 * The between-round budget check in `anthropicToolLoop` only runs BEFORE a round's create/stream
 * call starts. Nothing previously re-checked the clock while that round's OWN
 * `Promise.all(toolCalls.map(...))` was in flight, so one stalled tool call (queued behind the UW
 * rate limiter, a slow Polygon chain fetch, a cold GEX matrix rebuild) could block the ENTIRE round
 * — and therefore the loop — past its wall-clock budget, no matter how little time was left.
 *
 * MEASURED ON PROD, 2026-10-18 11:36-12:09 UTC: 85 Deep-mode turns, mean total_ms ~47000, worst
 * 121197ms against a 75000ms loop budget (`largoDepthConfig("deep").loopBudgetMs`) — up to +41000ms
 * overshoot — 9/85 answered:false, correlated with UW queue_wait_ms up to 18428ms. 7/8 of the prior
 * 14-day "tool loop hit its budget" log hits fired after only round 1-2, i.e. one round's OWN
 * duration (not the cumulative sum of many rounds) consumed the whole budget — exactly what a
 * round-level deadline, not a between-round one, is needed to catch.
 *
 * `raceToolRoundAgainstBudget` is the fix's pure, SDK-free core: genuinely unit-testable with a fake
 * slow promise, no Anthropic client mocking required (the client is not dependency-injected —
 * `getClient()` calls `new Anthropic(...)` directly, same reason
 * `shouldFallBackToEscalationModel`/`extractTextFromLastAssistant` are factored out this way).
 */

test("RED/GREEN CORE: resolves to the sentinel near the deadline, not the late real value", async () => {
  const start = Date.now();
  const slow = new Promise<string>((resolve) => setTimeout(() => resolve("late"), 500));
  const result = await raceToolRoundAgainstBudget(slow, 50);
  const elapsed = Date.now() - start;
  assert.equal(result, TOOL_ROUND_BUDGET_EXCEEDED, "a round that outlives the remaining budget must yield the sentinel, not wait out the real promise");
  assert.ok(elapsed < 300, `must return near the 50ms deadline, not wait for the 500ms promise (took ${elapsed}ms)`);
});

test("a tool round that settles before the deadline returns its real value untouched", async () => {
  const fast = Promise.resolve(["ok", { error: "x" }]);
  const result = await raceToolRoundAgainstBudget(fast, 5_000);
  assert.deepEqual(result, ["ok", { error: "x" }], "must pass the real settled value through byte-identical when there is no timeout");
});

test("an already-exhausted budget (negative remainingMs) resolves to the sentinel immediately, never hangs", async () => {
  const start = Date.now();
  const neverSettles = new Promise<string>(() => {
    /* deliberately never resolves — proves Math.max(0, remainingMs) clamps a negative delay */
  });
  const result = await raceToolRoundAgainstBudget(neverSettles, -5_000);
  const elapsed = Date.now() - start;
  assert.equal(result, TOOL_ROUND_BUDGET_EXCEEDED);
  assert.ok(elapsed < 200, `a negative remainingMs must not become a negative setTimeout delay (took ${elapsed}ms)`);
});

test("an unbounded budget still resolves to the real result with no artificial delay", async () => {
  // Large-but-finite remainingMs (this helper is always called with a real number in anthropic.ts —
  // the `loopBudgetMs > 0` guard there is what makes "no budget" skip this path entirely).
  const start = Date.now();
  const result = await raceToolRoundAgainstBudget(Promise.resolve(42), 60_000);
  assert.equal(result, 42);
  assert.ok(Date.now() - start < 200, "must not wait anywhere near the long deadline when the promise is already settled");
});

// ---- Source-level regression: the loop body must actually be wired to use the race. ----
// Reaching the real call sites inside `anthropicToolLoop` needs a live Anthropic client (not
// dependency-injected — see loop-budget.test.ts's own identical rationale), so this asserts on
// source the same way that file already does for the sibling between-round guard.

const ANTHROPIC = readFileSync(join(process.cwd(), "src/lib/providers/anthropic.ts"), "utf8");

test("REGRESSION: the round's tool fan-out is raced against the remaining loop budget", () => {
  assert.match(
    ANTHROPIC,
    /raceToolRoundAgainstBudget\(toolsPromise, remainingMs\)/,
    "the tool-execution Promise.all must be raced against the budget, not awaited unconditionally"
  );
  assert.match(
    ANTHROPIC,
    /raced === TOOL_ROUND_BUDGET_EXCEEDED/,
    "the loop must check the race outcome against the sentinel"
  );
});

test("REGRESSION: a round-level timeout reports loop_budget and returns the accumulated partial text", () => {
  // Must reuse the EXISTING stop reason (no new ToolLoopStopReason member) — classifyEmptyAnswer
  // already maps "loop_budget" to the correct member-facing "timeout" copy.
  const raceBlock = ANTHROPIC.slice(ANTHROPIC.indexOf("const toolsPromise = Promise.all("));
  const timeoutReturn = raceBlock.match(/if \(raced === TOOL_ROUND_BUDGET_EXCEEDED\) \{[\s\S]*?\n      \}/)?.[0] ?? "";
  assert.match(timeoutReturn, /stop\("loop_budget", extractTextFromLastAssistant/);
});

test("REGRESSION: the timeout path returns BEFORE the tool_result message is pushed", () => {
  // Must not fabricate placeholder tool_result content for calls that never settled.
  const toolsIdx = ANTHROPIC.indexOf("const toolsPromise = Promise.all(");
  const raceReturnIdx = ANTHROPIC.indexOf('return stop("loop_budget"', toolsIdx);
  const pushIdx = ANTHROPIC.indexOf('messages.push({\n      role: "user",', toolsIdx);
  assert.ok(toolsIdx > -1 && raceReturnIdx > -1 && pushIdx > -1, "expected source anchors not found — did the loop body move?");
  assert.ok(raceReturnIdx < pushIdx, "the budget-exceeded return must come before the tool_result message is constructed");
});

test("REGRESSION: an omitted/zero loop budget still awaits the fan-out unconditionally (byte-identical for non-Largo callers)", () => {
  assert.match(
    ANTHROPIC,
    /\} else \{\s*\n\s*results = await toolsPromise;\s*\n\s*\}/,
    "every caller that omits loopBudgetMs (commentary, digests, crons) must keep the old unbounded await"
  );
});

test("REGRESSION: the race applies on every round, including round 0 (no round > 0 floor on this guard)", () => {
  // Unlike the between-round check (which deliberately floors at round > 0 to guarantee one
  // attempt), this guard runs after round 0's own model response has already arrived, so there is
  // no reason to exempt it — mirrors the mid-loop spend-ceiling check, which also has no round floor.
  const toolsIdx = ANTHROPIC.indexOf("const toolsPromise = Promise.all(");
  const guardBlock = ANTHROPIC.slice(toolsIdx, ANTHROPIC.indexOf("messages.push({\n      role: \"user\",", toolsIdx));
  assert.match(guardBlock, /if \(loopBudgetMs > 0\) \{/);
  assert.doesNotMatch(guardBlock, /round > 0/, "the tool-fan-out race must not carry the between-round check's round>0 floor");
});

test("the pre-existing between-round budget check is untouched", () => {
  // Same literal this fix must not disturb — loop-budget.test.ts's own "checked between rounds"
  // assertion pins the identical pattern; re-asserted here so a regression in either file is caught
  // from both directions.
  assert.match(ANTHROPIC, /round > 0 && Date\.now\(\) - loopStartedAt >= loopBudgetMs/);
});
