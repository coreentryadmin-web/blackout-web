import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeEnvelope, envelopeFromMarkdown } from "@/lib/bie/answer-envelope";

// A genuinely RICH synthesis envelope (multi-section + evidence + scenarios) — the shape the verdict
// composer produces. Must be attached to the query response as `envelope`.
const RICH_ENVELOPE = makeEnvelope({
  headline: "SPX verdict 7500: long-γ range, neutral — moderate confidence",
  bias: "neutral",
  intent: "verdict",
  sections: [
    { title: "Dealer positioning", body: "Spot 7500 · γflip 7480", bias: "neutral", provenance: { source: "Vector GEX", freshness: "live" } },
    { title: "Options flow", body: "120 prints · call-led" },
  ],
  evidence: [{ kind: "fact", text: "spot 7500 vs γflip 7480", provenance: { source: "GEX" } }],
  confidence: { level: "moderate", why: "two live surfaces" },
  scenarios: [{ kind: "bull", thesis: "holds 7480" }],
  levels: [{ label: "gamma flip", price: 7480 }],
});

// The transition SHIM composeBieAnswer wraps a plain-string leg in — one bare "Read" section, no
// evidence/levels/scenarios. Must NOT be attached (the client renders the markdown instead).
const SHIM_ENVELOPE = envelopeFromMarkdown("**Command board:** NVDA long is live at 142.5c, +50%.", {
  headline: "0DTE plays",
  intent: "zerodte_plays",
});

// Task #103 — persist tools_used + intent_bucket into bie_interactions so #112's
// self-eval loop can eventually know what ACTUALLY happened on a Largo turn (which
// tools ran, and whether the router answered deterministically or fell through to
// Claude). This file drives runLargoQuery/runLargoQueryStream end-to-end (mocking
// only the provider/DB boundary) for both branches and asserts on the exact row
// handed to insertBieInteraction.

// Hermetic fixture — makes dbConfigured() true so logBie() actually attempts the
// (mocked) insertBieInteraction call, mirroring run-tool.test.ts's own pattern.
// No real Postgres connection is ever attempted: every db.ts-touching module on
// this code path is mocked below.
process.env.DATABASE_URL = "postgres://test-hermetic-fixture";
// anthropicConfigured() must read true for runLargoQuery/Stream to proceed past
// their opening guard — anthropicToolLoop/anthropicText are mocked below and never
// make a real request, so this key is never actually used.
process.env.ANTHROPIC_API_KEY = "sk-ant-test-hermetic-fixture";

type InsertedRow = {
  user_id: string | null;
  question: string;
  intent: string | null;
  answer_source: string;
  claims_total: number | null;
  claims_verified: number | null;
  latency_ms: number | null;
  tools_used: string[];
  intent_bucket: string;
};

let inserted: InsertedRow[] = [];
let toolLoopToolNames: string[] = [];
// Task #165 — when set, the mocked anthropicToolLoop below dispatches one tool (so the
// failure row's tools_used can be proven to carry whatever partial progress happened before
// the throw) and then throws this error, simulating a real tool-loop failure (timeout,
// Anthropic API error, etc.) instead of resolving with an answer.
let toolLoopError: Error | null = null;

// When set, the mocked loop replays this event sequence through params.onEvent before returning.
// Lets the streaming tests assert exactly which events reach the SSE client — the progressive
// answer depends on token AND answer_reset being forwarded, and on nothing else being.
let toolLoopEvents: Array<{ type: string; text?: string; name?: string }> | null = null;

// Task #166 — captures every appendLargoMessage() call so the router-path tests below can
// assert the fix directly: a BIE-router-composed assistant turn must now be persisted WITH a
// non-empty toolResults array (routed.context), not omitted as it was before this fix. See
// largo-store.ts's fetchRecentLargoAnswersWithResults doc comment for why that mattered — a
// router turn persisted with no tool_results was invisible to largo-verifier.ts's nightly
// numeric-grounding audit.
type AppendedCall = {
  role: "user" | "assistant";
  content: string;
  toolsUsed: string[];
  toolResults: unknown[] | undefined;
};
let appended: AppendedCall[] = [];

let runLargoQuery: typeof import("./largo-terminal").runLargoQuery;
let runLargoQueryStream: typeof import("./largo-terminal").runLargoQueryStream;
let isRichBieEnvelope: typeof import("./largo-terminal").isRichBieEnvelope;

// logBie() (largo-terminal.ts) fires the DB write as a detached
// `void import("./db").then((m) => m.insertBieInteraction(row))` — deliberately
// never awaited by its caller, so a slow/failed write can never delay or break the
// member-visible answer. That means runLargoQuery/Stream's own returned promise
// resolves before the detached write necessarily has landed. Poll instead of a
// fixed number of microtask/macrotask flushes — empirically the dynamic import
// takes a variable number of ticks to settle, and a single setImmediate proved
// flaky (a prior test's insert would land mid-way through the NEXT test).
async function waitForInserts(count: number, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (inserted.length < count) {
    if (Date.now() - start > timeoutMs) return; // let the assertion below fail with a clear diff
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

before(async () => {
  // namedExports fully REPLACES a module's exports (see run-tool.test.ts's note) —
  // spread the real db.ts module and override only insertBieInteraction, so every
  // other real db.ts function stays intact for anything that imports "@/lib/db"
  // (module identity is by resolved file path, so this applies process-wide).
  const realDb = await import("./db");
  mock.module("./db", {
    namedExports: {
      ...realDb,
      insertBieInteraction: async (row: InsertedRow) => {
        inserted.push(row);
      },
    },
  });

  mock.module("./providers/anthropic", {
    namedExports: {
      anthropicConfigured: () => true,
      anthropicText: async () => "",
      // Simulates a real Largo turn: the model calls two tools, then answers.
      anthropicToolLoop: async (params: {
        runTool: (name: string, input: Record<string, unknown>) => Promise<unknown>;
        onEvent?: (e: { type: string; text?: string; name?: string }) => void;
      }) => {
        if (toolLoopEvents) {
          for (const e of toolLoopEvents) params.onEvent?.(e);
          return "**Verdict**\nNVDA is holding above VWAP.\n\n**Data**\nSpot 223.80.";
        }
        if (toolLoopError) {
          // Partial progress before the failure — proves the logged failure row's
          // tools_used carries whatever really happened, not an empty placeholder.
          await params.runTool("get_quote", { ticker: "NVDA" });
          toolLoopToolNames.push("get_quote");
          throw toolLoopError;
        }
        await params.runTool("get_quote", { ticker: "NVDA" });
        await params.runTool("get_technicals", { ticker: "NVDA" });
        toolLoopToolNames.push("get_quote", "get_technicals");
        return "NVDA is holding above VWAP. **Bottom line:** momentum favors calls.";
      },
      LARGO_MODEL: "claude-test-model",
      COMMENTARY_MODEL: "claude-test-fast-model",
    },
  });

  // The real run-tool.ts pulls in nearly every provider client (Polygon/UW/
  // Benzinga/etc.) — irrelevant to this file's concern (does the DISPATCHED tool
  // list reach bie_interactions), so it's stubbed wholesale, same rationale
  // run-tool.test.ts documents for mocking "server-only"'s transitive pull-in.
  mock.module("./largo/run-tool", {
    namedExports: {
      runLargoTool: async () => ({ ok: true }),
    },
  });

  // spx-desk-cache.ts transitively imports providers/spx-desk.ts, which has
  // `import "server-only"` somewhere in ITS graph — same category of problem
  // run-tool.test.ts documents for get_positioning's gex-positioning.ts pull-in.
  // resetLargoSpxDeskCache is a one-line in-memory Map.delete(); stubbing it
  // avoids loading that whole chain under plain `node --test` (no Next.js
  // "react-server" condition to satisfy server-only's export map).
  mock.module("./largo/spx-desk-cache", {
    namedExports: {
      resetLargoSpxDeskCache: () => {},
    },
  });

  mock.module("./largo/largo-store", {
    namedExports: {
      ensureLargoSession: async () => {},
      fetchLargoHistory: async () => [],
      fetchLargoMessagesPublic: async () => [],
      // No previous turn in these fixtures — the first-turn case, where conversation state
      // contributes nothing and no "since I last asked" window can be resolved.
      fetchPreviousUserTurn: async () => null,
      sessionOwnedByUser: async () => true,
      appendLargoMessage: async (
        _sid: string,
        _userId: string,
        role: "user" | "assistant",
        content: string,
        toolsUsed: string[] = [],
        toolResults?: unknown[]
      ) => {
        appended.push({ role, content, toolsUsed, toolResults });
      },
    },
  });

  // Real captureLargoLiveFeed reaches live Polygon/UW providers — replaced with a
  // fixed minimal feed so the Claude-fallback branch never attempts network I/O.
  mock.module("./largo/largo-live-feed", {
    namedExports: {
      captureLargoLiveFeed: async () => ({}),
      formatLargoLiveFeed: () => "live feed placeholder",
    },
  });

  mock.module("./largo/platform-snapshot-block", {
    namedExports: {
      loadLargoPlatformSnapshotBlock: async () => "",
    },
  });

  // classifyBieIntent/bieIntentBucket are deliberately left REAL (unmocked) —
  // this suite exists to prove the real router decision reaches the persisted
  // row, not a stand-in for it.
  mock.module("./bie/composers", {
    namedExports: {
      // Only "zerodte_plays"/"market_context" compose here (the two intents this
      // suite's router-path tests actually drive) — any other intent falls
      // through to Claude the same way an unmatched question would, which is
      // enough to exercise both logBie branches without wiring up every composer.
      composeBieAnswer: async (route: { intent: string }) => {
        if (route.intent === "zerodte_plays") {
          // Carries a SHIM envelope (as production composeBieAnswer now always does for a string
          // leg) — used below to prove the API gate DROPS a non-rich envelope.
          return {
            answer: "**Command board:** NVDA long is live at 142.5c, +50%.",
            context: { live_pnl_pct: 50 },
            envelope: SHIM_ENVELOPE,
          };
        }
        if (route.intent === "market_context") {
          return {
            answer: "**Market context:** SPX grinding higher, VIX pinned low.",
            context: { vix: 12.5 },
          };
        }
        if (route.intent === "verdict") {
          // The rich synthesis path — its populated envelope MUST reach the response.
          return {
            answer: RICH_ENVELOPE.markdown,
            context: { verdict: true },
            envelope: RICH_ENVELOPE,
          };
        }
        return null;
      },
    },
  });

  mock.module("./zerodte/scan", {
    namedExports: {
      readZeroDteLedger: async () => [],
    },
  });

  mock.module("./bie/knowledge", {
    namedExports: {
      searchKnowledge: async () => [],
    },
  });

  // largo-live-prefetch.ts has `import "server-only"` at the top — turn-pipeline.ts
  // imports it, so loading the real module throws under plain `node --test` (no
  // Next.js "react-server" condition). Stub the prefetch to a no-op.
  mock.module("./bie/largo-live-prefetch", {
    namedExports: {
      prefetchLargoLiveFeed: async () => {},
      LARGO_LIVE_PREFETCH_BLOCK_MS: 2500,
    },
  });

  mock.module("./largo/turn-pipeline", {
    namedExports: {
      prefetchLargoTurnCaches: async () => {},
    },
  });

  // Imported dynamically, AFTER every mock above is registered
  ({ runLargoQuery, runLargoQueryStream, isRichBieEnvelope } = await import("./largo-terminal"));
});

test("runLargoQuery: every turn uses the Claude tool loop (no BIE router)", async () => {
  inserted = [];
  appended = [];
  toolLoopToolNames = [];
  const result = await runLargoQuery("How are today's plays doing?", "", "user-1", []);
  await waitForInserts(1);

  assert.equal(result.source, "blackout-web+postgres");
  assert.equal(inserted.length, 1);
  const row = inserted[0]!;
  assert.equal(row.answer_source, "claude");
  assert.equal(row.intent, null);
  assert.equal(row.intent_bucket, "claude_fallback");
  assert.deepEqual(row.tools_used, ["live_feed_capture", "get_quote", "get_technicals"]);
  assert.match(result.answer, /VWAP|NVDA|Bottom line/i);

  assert.equal(appended.length, 2);
  const assistantCall = appended.find((c) => c.role === "assistant")!;
  assert.deepEqual(assistantCall.toolResults, [{ ok: true }, { ok: true }]);
});

test("runLargoQuery: Claude turn persists intent_bucket = 'claude_fallback' and dispatched tool names", async () => {
  inserted = [];
  appended = [];
  toolLoopToolNames = [];
  // "Why did NVDA reverse?" fails classifyBieIntent's REASONING_RE guard ("why")
  // — falls through to Claude, exactly like a real unmatched member question.
  const result = await runLargoQuery("Why did NVDA reverse today?", "", "user-2", []);
  await waitForInserts(1);

  assert.equal(inserted.length, 1);
  const row = inserted[0]!;
  assert.equal(row.answer_source, "claude");
  // The pre-existing `intent` column keeps its original null-on-fallback meaning
  // (untouched, purely additive change) —
  assert.equal(row.intent, null);
  // — while the new intent_bucket column gives fallback turns an explicit,
  // queryable sentinel instead of a bare NULL.
  assert.equal(row.intent_bucket, "claude_fallback");
  // The actual tool names dispatched this turn, deduped — "live_feed_capture" is
  // seeded into every Claude-path turn by prepareLargoTurn() before the model
  // calls anything (largo-terminal.ts's toolsUsed seed), plus the two tools the
  // mocked tool loop actually invoked. Not an empty array, not a placeholder.
  assert.deepEqual(row.tools_used, ["live_feed_capture", "get_quote", "get_technicals"]);
  assert.equal(result.source, "blackout-web+postgres");

  // Task #166 is scoped to the router path — confirm the pre-existing Claude-tool-loop
  // persistence (capturedResults, already correct before this fix) is untouched.
  const assistantCall = appended.find((c) => c.role === "assistant")!;
  assert.deepEqual(assistantCall.toolResults, [{ ok: true }, { ok: true }]);
});

test("runLargoQueryStream: streaming path uses Claude tool loop", async () => {
  inserted = [];
  appended = [];
  toolLoopToolNames = [];
  const events: unknown[] = [];
  await runLargoQueryStream("What's the market doing?", "", "user-3", (e) => events.push(e), []);
  await waitForInserts(1);

  assert.equal(inserted.length, 1);
  const row = inserted[0]!;
  assert.equal(row.answer_source, "claude");
  assert.equal(row.intent_bucket, "claude_fallback");
  assert.deepEqual(row.tools_used, ["live_feed_capture", "get_quote", "get_technicals"]);

  const assistantCall = appended.find((c) => c.role === "assistant")!;
  assert.deepEqual(assistantCall.toolResults, [{ ok: true }, { ok: true }]);
});

test("runLargoQueryStream: Claude streaming persists tool names", async () => {
  inserted = [];
  toolLoopToolNames = [];
  const events: unknown[] = [];
  // Use a question that no BIE route matches — the original "Should I hold my TSLA play"
  // now routes to ticker_advice → composer-failed fallback (the fix this PR introduces).
  await runLargoQueryStream("I lost money on my trades today", "", "user-4", (e) => events.push(e), []);
  await waitForInserts(1);

  assert.equal(inserted.length, 1);
  const row = inserted[0]!;
  assert.equal(row.answer_source, "claude");
  assert.equal(row.intent, null);
  assert.equal(row.intent_bucket, "claude_fallback");
  assert.deepEqual(row.tools_used, ["live_feed_capture", "get_quote", "get_technicals"]);
});

// Task #165 — root cause: runLargoQuery's try block wrapping anthropicToolLoop had ONLY a
// finally, no catch, so a thrown error skipped logBie() entirely and propagated straight to
// the API route (a bare 502) with no trace in bie_interactions. These two tests lock in the
// fix: the error must still propagate/emit completely unchanged (never swallowed), AND a
// minimal failure row must land so calibration reports can see the failure happened at all.
test("runLargoQuery: a thrown tool-loop error still propagates AND writes a logBie row with answer_source 'error'", async () => {
  inserted = [];
  toolLoopToolNames = [];
  toolLoopError = new Error("tool loop boom");
  try {
    await assert.rejects(
      () => runLargoQuery("Why did NVDA reverse today?", "", "user-err-1", []),
      /tool loop boom/
    );
    await waitForInserts(1);

    assert.equal(inserted.length, 1);
    const row = inserted[0]!;
    assert.equal(row.answer_source, "error");
    // Claims are explicitly null (never 0) — a turn that never produced an answer has no
    // claims that were "verified none of," which is what 0 would falsely imply.
    assert.equal(row.claims_total, null);
    assert.equal(row.claims_verified, null);
    assert.equal(row.intent, null);
    assert.equal(row.intent_bucket, "claude_fallback");
    // Whatever tool progress happened before the throw is still captured — not an empty
    // placeholder — same "real tool names dispatched this turn" contract as the success path.
    assert.deepEqual(row.tools_used, ["live_feed_capture", "get_quote"]);
    assert.equal(typeof row.latency_ms, "number");
  } finally {
    toolLoopError = null;
  }
});

test("runLargoQueryStream: a thrown tool-loop error still emits an 'error' SSE event AND writes a logBie row with answer_source 'error'", async () => {
  inserted = [];
  toolLoopToolNames = [];
  toolLoopError = new Error("stream tool loop boom");
  try {
    const events: unknown[] = [];
    // runLargoQueryStream's own catch swallows the error (it emits an SSE event instead of
    // rethrowing) — the call must resolve, not reject. Use a question that no BIE route
    // matches so we fall through to the Claude tool-loop where the toolLoopError can trigger.
    await runLargoQueryStream("I lost money on my trades today", "", "user-err-2", (e) =>
      events.push(e)
    , []);
    await waitForInserts(1);

    assert.equal(inserted.length, 1);
    const row = inserted[0]!;
    assert.equal(row.answer_source, "error");
    assert.equal(row.claims_total, null);
    assert.equal(row.claims_verified, null);
    assert.equal(row.intent_bucket, "claude_fallback");
    assert.deepEqual(row.tools_used, ["live_feed_capture", "get_quote"]);

    // The pre-existing error-event behavior is completely unchanged by this fix — purely
    // additive logging, never a swallow of the visible failure signal either.
    const errorEvent = events.find((e) => (e as { type?: string }).type === "error") as
      | { type: string; message: string }
      | undefined;
    assert.ok(errorEvent, "expected an 'error' SSE event");
    assert.equal(errorEvent?.message, "stream tool loop boom");
  } finally {
    toolLoopError = null;
  }
});

test("isRichBieEnvelope: rich synthesis → true; string-leg shim → false; nullish → false", () => {
  assert.equal(isRichBieEnvelope(RICH_ENVELOPE), true);
  assert.equal(isRichBieEnvelope(SHIM_ENVELOPE), false);
  assert.equal(isRichBieEnvelope(null), false);
  assert.equal(isRichBieEnvelope(undefined), false);
});

// ── Progressive answer streaming ──────────────────────────────────────────────────────────────

test("runLargoQueryStream forwards tokens so the answer appears as it is written", async () => {
  // Before this, the streaming path forwarded tool_start ONLY and dropped every token, so the
  // member watched a spinner for the whole turn and the answer arrived as one block at the end.
  inserted = [];
  appended = [];
  toolLoopToolNames = [];
  toolLoopEvents = [
    { type: "token", text: "NVDA is " },
    { type: "token", text: "holding above VWAP." },
  ];
  try {
    const events: Array<{ type: string; text?: string }> = [];
    await runLargoQueryStream("nvda?", "", "user-stream-1", (e) =>
      events.push(e as { type: string; text?: string }), []
    );
    const tokens = events.filter((e) => e.type === "token").map((e) => e.text);
    assert.equal(tokens[0], "NVDA is ", "the model's text streams as it is written");
    assert.equal(tokens[1], "holding above VWAP.");
    // The turn closes by resetting and re-emitting the VERIFIED text, so a consumer that reads
    // only tokens still ends up holding the caveated copy rather than the raw one.
    const kinds = events.map((e) => e.type);
    assert.equal(kinds[kinds.length - 1], "done");
    assert.equal(kinds[kinds.length - 3], "answer_reset");
    assert.match(String(tokens[tokens.length - 1]), /Verdict/);
  } finally {
    toolLoopEvents = null;
  }
});

test("answer_reset is forwarded so planning chatter never renders in front of the answer", async () => {
  // Tokens stream from EVERY round, and a round ending in tool_use was the model narrating its
  // plan ("Let me check the chain first…"). Concatenating everything glues that to the front of
  // the real answer, which reads as the model talking to itself in the member's chat window.
  inserted = [];
  appended = [];
  toolLoopToolNames = [];
  toolLoopEvents = [
    { type: "token", text: "Let me check the chain first." },
    { type: "answer_reset" },
    { type: "tool_start", name: "get_quote" },
    { type: "token", text: "**Verdict**\nNVDA is holding above VWAP." },
  ];
  try {
    const events: Array<{ type: string; text?: string }> = [];
    await runLargoQueryStream("nvda?", "", "user-stream-2", (e) =>
      events.push(e as { type: string; text?: string }), []
    );

    const kinds = events.map((e) => e.type);
    assert.ok(kinds.includes("answer_reset"), "the reset must reach the client");
    assert.ok(
      kinds.indexOf("answer_reset") < kinds.lastIndexOf("token"),
      "the reset must arrive BEFORE the answer tokens, or it would erase them"
    );

    // Replaying what a consumer does: clear on reset, accumulate otherwise.
    let buffer = "";
    for (const e of events) {
      if (e.type === "answer_reset") buffer = "";
      else if (e.type === "token" && e.text) buffer += e.text;
    }
    assert.ok(!buffer.includes("Let me check"), "planning text survived the reset");
    assert.match(buffer, /Verdict/);
  } finally {
    toolLoopEvents = null;
  }
});

test("the done answer is authoritative — a consumer must REPLACE the stream, never append", async () => {
  // Load-bearing, not cosmetic. The final text is the only one that has been through
  // verifyClaims/applyVerificationCaveat and the plan-timeframe caveat, so a member reading only
  // the streamed text could act on an unverified number whose caveat never arrived.
  inserted = [];
  appended = [];
  toolLoopToolNames = [];
  toolLoopEvents = [{ type: "token", text: "partial text that is NOT the final answer" }];
  try {
    const events: Array<{ type: string; answer?: string }> = [];
    await runLargoQueryStream("nvda?", "", "user-stream-3", (e) =>
      events.push(e as { type: string; answer?: string }), []
    );
    const done = events.find((e) => e.type === "done")!;
    assert.ok(done, "a done event must always close the stream");
    assert.ok(
      !done.answer!.includes("partial text that is NOT"),
      "done.answer is built from the loop's return value, independent of what streamed"
    );
    assert.match(done.answer!, /Verdict/);
  } finally {
    toolLoopEvents = null;
  }
});

/**
 * THE LIVE FEED MUST REACH THE CARD.
 *
 * `captureLargoLiveFeed` runs a dozen real tools before the model plans and the results were
 * rendered into the system prompt as TEXT and then dropped. `live_feed_capture` is pushed onto
 * `toolsUsed`, which makes it look like a captured tool. Nothing captured it.
 *
 * Measured live 2026-08-11: "what is the SPX gamma picture right now" and "Create an image for
 * tomorrows NH plays" each ran exactly `live_feed_capture` + `platform_vitals_prefetch` and nothing
 * else. Largo answered both from the feed, correctly and in detail; the card refused with an EMPTY
 * signal list. Asserted on the source because the wiring — not the behaviour of any one function —
 * is what was missing, the same way `visual-mount.test.ts` pins its chain.
 */

const TERMINAL_SRC = readFileSync("src/lib/largo-terminal.ts", "utf8");

test("the live feed's payloads are returned from the turn prelude", () => {
  assert.match(TERMINAL_SRC, /liveFeedResults: Object\.values\(liveFeed\)/);
  assert.match(TERMINAL_SRC, /liveFeedResults: unknown\[\]/, "and typed on the prelude's contract");
});

test("BOTH transports fold them into the turn's captured results", () => {
  const folded = TERMINAL_SRC.match(/capturedResults\.push\(\.\.\.liveFeedResults\)/g) ?? [];
  assert.equal(folded.length, 2, `folded on ${folded.length} paths, expected stream and non-stream`);
});

test("they are APPENDED, so an explicitly-called tool still wins", () => {
  // `findPositioning`/`findQuote` take the FIRST match. Prepending would let the ambient feed
  // outrank a tool the model deliberately called for this question — the feed may be scoped to a
  // different instrument entirely. Appending can only fill gaps.
  const at = TERMINAL_SRC.indexOf("capturedResults.push(...liveFeedResults)");
  const loopAt = TERMINAL_SRC.indexOf("runTool: makeGuardedToolRunner");
  assert.ok(at > loopAt, "the fold must come after the tool loop, not before it");
});
