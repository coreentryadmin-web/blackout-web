import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { largoDepthConfig } from "@/lib/largo/largo-depth";
import { extractTextFromLastAssistant } from "@/lib/providers/anthropic";
import { largoMemberRouteDeadlineMs, largoToolLoopBudgetMs } from "@/lib/providers/config";

/**
 * The tool loop had no wall-clock budget at all.
 *
 * `timeoutMs` is PER REQUEST — anthropic.ts spends it as the client's `timeout` on each round, and
 * its own comment says so ("a single slow round can't hang on the 20s client default"). Nothing
 * bounded the loop across rounds, so Deep dive's `maxRounds: 10` was unbounded in practice: ten
 * individually-legal rounds add up with nothing stopping them.
 *
 * MEASURED ON PROD 2026-08-20: Deep turns of 81.7s, 89.8s and 98.3s against what every caller had
 * been reading as a "75s timeout". Two of the three returned NOTHING — the member got an
 * empty-answer message blaming missing data for a turn that had plenty of data and simply ran long.
 *
 * The budget already existed and was wired to the wrong thing. `largoToolLoopBudgetMs()` is
 * documented as "route deadline minus prefetch/post overhead"; largo-terminal spent it clamping a
 * per-ROUND timeout. Same shape as the other findings this audit turned up: the correct thing was
 * present and simply not connected.
 */

const root = process.cwd();
const TERMINAL = readFileSync(join(root, "src/lib/largo-terminal.ts"), "utf8");
const ANTHROPIC = readFileSync(join(root, "src/lib/providers/anthropic.ts"), "utf8");

test("the loop must give up BEFORE the route deadline, not after", () => {
  // THE ORDERING THAT MAKES THE FIX WORK. The route races every turn against a 100s deadline and
  // returns its own generic message. A loop budget at or above that could never fire — the route
  // would always win, and the member would get "this ran long" instead of the partial answer the
  // loop had already written. My first draft of this fix used 105s and would have been inert.
  for (const depth of ["concrete", "deep"] as const) {
    const budget = Math.min(largoDepthConfig(depth).loopBudgetMs, largoToolLoopBudgetMs());
    assert.ok(
      budget < largoMemberRouteDeadlineMs(),
      `${depth} loop budget ${budget}ms must be under the ${largoMemberRouteDeadlineMs()}ms route deadline`
    );
    // Headroom is not decoration: verifyClaims, applyVerificationCaveat and persistence all run
    // AFTER the loop returns, on the very answer the budget rescued. A budget that leaves no room
    // for them trades one timeout for another.
    assert.ok(
      largoMemberRouteDeadlineMs() - budget >= 20_000,
      `${depth} leaves only ${largoMemberRouteDeadlineMs() - budget}ms for post-loop work`
    );
  }
});

test("the per-round timeout never exceeds the whole-loop budget", () => {
  // Otherwise one round could legally outlive the loop it belongs to, and the budget would only
  // ever be observed after the damage.
  for (const depth of ["concrete", "deep"] as const) {
    const cfg = largoDepthConfig(depth);
    assert.ok(
      cfg.timeoutMs <= cfg.loopBudgetMs,
      `${depth}: per-round ${cfg.timeoutMs}ms > loop ${cfg.loopBudgetMs}ms`
    );
  }
});

test("Deep dive's budget is the one the config already computed", () => {
  // Not a fresh magic number. If someone tunes LARGO_MEMBER_ROUTE_DEADLINE_MS, the clamp in
  // largo-terminal follows it; this asserts the constant here has not drifted off the default.
  assert.equal(largoDepthConfig("deep").loopBudgetMs, largoToolLoopBudgetMs());
});

test("REGRESSION: both anthropicToolLoop call sites pass a loop budget", () => {
  // Asserted on source — reaching the real call sites needs Clerk, Redis, Polygon and an Anthropic
  // key. The failure being guarded is an omission, and an omission is exactly what a source check
  // can see: a future call site that passes `timeoutMs` alone is silently unbounded again.
  const calls = TERMINAL.match(/timeoutMs: largoLoopTimeoutMs\(depth\)/g) ?? [];
  const budgets = TERMINAL.match(/loopBudgetMs: largoLoopBudgetMs\(depth\)/g) ?? [];
  assert.ok(calls.length >= 2, "expected both the concrete and streaming loop call sites");
  assert.equal(budgets.length, calls.length, "every loop call site must carry a wall-clock budget");
});

test("REGRESSION: the empty-answer fallback measures against the LOOP budget", () => {
  // #2396 classifies an empty answer as a timeout past 85% of budget. It was handed the per-ROUND
  // limit while measuring TOTAL elapsed, so a 3-round Deep turn looked timed-out at round two and a
  // slow single-round one looked healthy. The classification was reading two different clocks.
  assert.doesNotMatch(
    TERMINAL,
    /budgetMs: largoLoopTimeoutMs\(depth\)/,
    "the fallback must not be graded against a per-round timeout"
  );
  const fallbacks = TERMINAL.match(/budgetMs: largoLoopBudgetMs\(depth\)/g) ?? [];
  assert.equal(fallbacks.length, 2, "both fallback sites");
});

test("the budget is checked between rounds and never before the first", () => {
  // A loop that returns before calling the model once would report "no data" having looked at
  // nothing — a confident non-answer, which is the failure mode this whole audit exists to remove.
  assert.match(ANTHROPIC, /round > 0 && Date\.now\(\) - loopStartedAt >= loopBudgetMs/);
});

test("an omitted budget preserves the old unbounded behaviour", () => {
  // Every other caller of anthropicToolLoop (commentary, digests, crons) passes no budget and must
  // not silently acquire one. Opt-in, not a behaviour change smuggled into shared code.
  assert.match(ANTHROPIC, /const loopBudgetMs = params\.loopBudgetMs \?\? 0;/);
  assert.match(ANTHROPIC, /loopBudgetMs > 0 &&/, "0 must disable the check entirely");
});

/**
 * What the early exits actually HAND BACK.
 *
 * All four of them (spend ceiling, this budget, a failed round create, a failed final synthesis)
 * return "the assistant text accumulated so far". Mid-loop, that text is the model narrating its
 * plan — "Let me pull the SPX GEX heatmap and check the flip" — because a round that ends in tool
 * calls is by construction not a finished answer.
 *
 * Narration is worse than nothing. The empty-answer fallback at least tells the member the turn did
 * not finish; narration LOOKS like an answer and carries no read at all — the same confident
 * non-answer shape as the fabricated vanna negative.
 *
 * The codebase already drew this distinction one layer over: the streaming path emits
 * `answer_reset` for precisely this case. It was enforced on the streamed text and not on the
 * returned value.
 */

type Msg = { role: string; content: unknown };

test("REGRESSION: a tool-call round's narration is never returned as the answer", () => {
  const messages: Msg[] = [
    { role: "user", content: "where is the SPX gamma flip?" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Let me pull the SPX GEX heatmap and check the flip." },
        { type: "tool_use", id: "t1", name: "get_gex_heatmap", input: { ticker: "SPX" } },
      ],
    },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{}" }] },
  ];
  assert.equal(
    extractTextFromLastAssistant(messages as never),
    null,
    "must fall through to the honest fallback rather than serve plan chatter"
  );
});

test("a real partial answer from an earlier round IS returned", () => {
  // The guard must not throw away genuine work. A finished answer has no tool_use block, so the
  // two cases are distinguishable without heuristics.
  const messages: Msg[] = [
    { role: "user", content: "where is the SPX gamma flip?" },
    { role: "assistant", content: [{ type: "text", text: "SPX gamma flip sits at 7,893.07." }] },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Now let me check the walls." },
        { type: "tool_use", id: "t2", name: "get_gex_heatmap", input: {} },
      ],
    },
  ];
  assert.equal(
    extractTextFromLastAssistant(messages as never),
    "SPX gamma flip sits at 7,893.07.",
    "skips the narration round and keeps the real answer behind it"
  );
});

test("plain-string assistant content still works", () => {
  // Not every caller builds block arrays; the string form has no tool_use to inspect and must pass
  // through untouched.
  const messages: Msg[] = [{ role: "assistant", content: "  SPX 7,707.98.  " }];
  assert.equal(extractTextFromLastAssistant(messages as never), "SPX 7,707.98.");
});
