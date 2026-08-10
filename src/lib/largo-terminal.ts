import {
  anthropicText,
  anthropicToolLoop,
  COMMENTARY_MODEL,
  LARGO_MODEL,
  type AnthropicMessage,
  type AnthropicSystemBlock,
  type AnthropicToolLoopEvent,
} from "@/lib/providers/anthropic";
import { largoAvailable, largoClaudeEnabled } from "@/lib/ai-env";
import { dbConfigured } from "@/lib/db";
import { LARGO_SYSTEM_PROMPT } from "@/lib/largo/system-prompt";
import { LARGO_TOOL_DEFS } from "@/lib/largo/tool-defs";
import { runLargoTool } from "@/lib/largo/run-tool";
import { prefetchLargoTurnCaches } from "@/lib/largo/turn-pipeline";
import {
  applyVerificationCaveat,
  logClaudeTurn,
  persistClaudeTurn,
} from "@/lib/largo/turn-outcome";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import { parseAnswerEnvelope, validateAnswerContract } from "@/lib/largo/answer-contract";
import { stripLargoBlocks } from "@/features/largo/blocks/extract";
import { collectContextNumbers, verifyClaims, type ClaimVerification } from "@/lib/bie/verifier";
import { resetLargoSpxDeskCache } from "@/lib/largo/spx-desk-cache";
import {
  appendLargoMessage,
  ensureLargoSession,
  fetchLargoHistory,
  fetchLargoMessagesPublic,
  sessionOwnedByUser,
} from "@/lib/largo/largo-store";
import { analyzeLargoQuestion } from "@/lib/largo/question-intent";
import { deterministicLargoFollowups } from "@/lib/largo/largo-followups";
import { loadLargoPlatformSnapshotBlock } from "@/lib/largo/platform-snapshot-block";
import { captureLargoLiveFeed, formatLargoLiveFeed } from "@/lib/largo/largo-live-feed";
import { polygonConfigured, uwConfigured } from "@/lib/providers/config";
import { webSearchConfigured } from "@/lib/providers/web-search";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { LARGO_CAPABILITIES, rankCapabilities } from "@/lib/largo/registry/capability-registry";
import { formatTemporalBlock, resolveTimeframe, temporalConflicts } from "@/lib/largo/temporal/timeframe";

const MAX_HISTORY = 28;

/** Thrown when the SSE client disconnects before the Largo turn finishes. */
export class SseClientDisconnected extends Error {
  constructor() {
    super("SSE client disconnected");
    this.name = "SseClientDisconnected";
  }
}

export function isSseClientDisconnect(err: unknown): boolean {
  if (err instanceof SseClientDisconnected) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("Controller is already closed") || msg.includes("Invalid state");
}

export type LargoStreamEvent =
  | AnthropicToolLoopEvent
  | { type: "status"; message: string }
  | {
      type: "done";
      answer: string;
      session_id: string;
      source: string;
      tools_used: string[];
      followups: string[];
      // Always present (audit finding: previously the specific unverified numbers were never
      // surfaced even when the in-text caveat fired, and never at all below its total>=4 &&
      // coverage<0.5 threshold) — the raw ClaimVerification so any caller can inspect exactly
      // which numeric claims traced to this turn's source data, independent of the in-text
      // caveat's own display threshold.
      verification: ClaimVerification;
      // The structured answer envelope. Since the BIE composer was removed this is produced by
      // PARSING Largo's own contract-conforming reply (answer-contract.ts) rather than by a
      // composer — so it is present on any answer that follows the mandatory section template, and
      // absent when the model drifted off it. The client renders it as evidence/level/scenario
      // cards; when absent it falls back to the raw `answer` markdown, which is what every Largo
      // answer rendered as before this shipped.
      envelope?: BieAnswerEnvelope;
    }
  | { type: "error"; message: string };

/**
 * Structural test for a rich synthesis envelope (verdict/sections) vs a trivial string leg.
 *
 * Still re-exported from `@/lib/bie/*` — one of the LAST BIE couplings left in Largo's runtime,
 * kept here only so this PR stays scoped to deleting the BIE answer-ROUTER and the dark retrieval
 * layer. The remaining couplings are data readers, the answer envelope and the claim verifier,
 * which are load-bearing (they are how Largo reaches platform state and how it is stopped from
 * fabricating numbers); those get RELOCATED into `@/lib/largo/`, not deleted, in the follow-up.
 */
export { isRichBieEnvelope } from "@/lib/bie/envelope-richness";

/**
 * Dynamic follow-up prompts — 3 short questions that continue THIS exact exchange
 * (same ticker/topic, drilling deeper or pivoting logically), generated from the
 * user's question + Largo's answer on a cheap fast model. Replaces the old fixed
 * suggestion chips. Fail-open: returns [] on any error / no key / spend-ceiling, so
 * follow-ups are a pure enhancement that never blocks or breaks the answer.
 */
export async function generateLargoFollowups(
  question: string,
  answer: string,
  tickerHint?: string | null
): Promise<string[]> {
  const fallback = deterministicLargoFollowups(question, tickerHint);
  if (!largoClaudeEnabled() || !answer.trim()) return fallback;

  const focus = tickerHint ? ` Focus ticker: ${tickerHint}.` : "";
  const prompt = `You generate follow-up questions for Largo — the AI desk lead on BlackOut Trading (SPX Slayer, HELIX flow, Thermal GEX, Vector, Night Hawk, 0DTE Command, Cortex gates, track record).${focus}

The member asked: "${question}"

Largo answered:
"""
${answer.slice(0, 2200)}
"""

Write exactly 3 follow-up questions the member would ask NEXT. Rules:
- Each must drill deeper into THIS exchange (same ticker/setup/topic) OR pivot to the logical cross-product angle (e.g. flow → GEX walls → invalidation).
- Prefer concrete, numerical asks ("Where's the gamma flip?", "Show strike stacks", "Cortex skip reason on NVDA") over vague prompts.
- Each ≤ 10 words, plain text, no numbering, no quotes.
Return ONLY the 3 questions, one per line.`;
  try {
    const out = await anthropicText(prompt, 200, undefined, {
      model: COMMENTARY_MODEL,
      temperature: 0.65,
      timeoutMs: 14_000,
      maxRetries: 1,
      aiGate: "largo",
    });
    if (!out) return fallback;
    const haiku = out
      .split("\n")
      .map((l) => l.replace(/^[\s\-*•\d.)]+/, "").replace(/^["']|["']$/g, "").trim())
      .filter((l) => l.length > 0 && l.length <= 96)
      .slice(0, 3);
    if (haiku.length >= 3) return haiku;
    const merged = [...haiku];
    for (const f of fallback) {
      if (merged.length >= 3) break;
      if (!merged.some((m) => m.toLowerCase() === f.toLowerCase())) merged.push(f);
    }
    return merged.slice(0, 3);
  } catch {
    return fallback;
  }
}

function trimHistory(history: AnthropicMessage[]) {
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

function buildDynamicSystem(
  question: string,
  history: AnthropicMessage[],
  liveFeedBlock: string,
  platformVitalsBlock: string
): AnthropicSystemBlock[] {
  const intent = analyzeLargoQuestion(question, history);
  const platformSection = platformVitalsBlock.trim()
    ? `\n\n${platformVitalsBlock.trim()}\n`
    : "";
  const dynamicPart = `## This turn

Session date (ET): ${todayEtYmd()}

${liveFeedBlock}${platformSection}

${intent.guidance}

Session memory is in Postgres — honor follow-ups. Re-fetch via tools if you need fresher flow, matrix, or platform numbers. Facts from the live feed and platform vitals only; opinion in Bottom line.`;

  return [
    {
      type: "text",
      text: LARGO_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: dynamicPart },
  ];
}

export function largoConfigured(): boolean {
  return largoAvailable();
}

export function largoDataSources(): {
  polygon: boolean;
  uw: boolean;
  postgres: boolean;
  web_search: boolean;
  anthropic: boolean;
} {
  return {
    polygon: polygonConfigured(),
    uw: uwConfigured(),
    postgres: dbConfigured(),
    web_search: webSearchConfigured(),
    anthropic: largoClaudeEnabled(),
  };
}

export async function getLargoSessionMessages(sessionId: string, userId: string) {
  const sid = sessionId.trim();
  if (!sid) return { session_id: "", messages: [] };
  if (dbConfigured() && !(await sessionOwnedByUser(sid, userId))) {
    return { session_id: sid, messages: [] };
  }
  const messages = await fetchLargoMessagesPublic(sid, userId);
  return { session_id: sid, messages };
}

async function prepareLargoTurn(
  question: string,
  sessionId: string,
  userId: string
): Promise<{
  sid: string;
  history: AnthropicMessage[];
  system: AnthropicSystemBlock[];
  filteredTools: typeof LARGO_TOOL_DEFS;
  toolsUsed: string[];
  tickerHint: string | null;
}> {
  let sid = sessionId.trim() || `web-${userId}-${Date.now()}`;
  try {
    await ensureLargoSession(sid, userId);
  } catch {
    // The supplied session id is owned by ANOTHER user (a client-generated `web-<ts>` id
    // collision — e.g. a shared device or same-ms timestamp) or is otherwise unusable.
    // ensureLargoSession throws on the ownership mismatch, which previously surfaced to the
    // user as a hard "Connection interrupted" error. Recover gracefully: abandon the foreign
    // id (never grant cross-user access) and start a FRESH session owned by THIS user. The new
    // id flows back in the done event, so the client adopts it for subsequent turns.
    sid = `web-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await ensureLargoSession(sid, userId);
  }

  const history = await fetchLargoHistory(sid, userId);
  history.push({ role: "user", content: question });
  trimHistory(history);

  // The user turn is persisted AFTER the assistant turn completes (see
  // runLargoQuery / runLargoQueryStream). Persisting it here — before a 12-round
  // tool loop that can abort or error — left an orphaned trailing user message,
  // so the next turn pushed a second user message, broke Anthropic role
  // alternation, and 400'd until the orphan aged out (LARGO-3).

  const toolsUsed: string[] = ["live_feed_capture"];
  const intent = analyzeLargoQuestion(question, history.slice(0, -1));
  const liveFeed = await captureLargoLiveFeed(intent, userId);
  const liveFeedBlock = formatLargoLiveFeed(liveFeed, intent.tickerHint ?? "SPX");
  // NO retrieval layer. This used to call searchKnowledge() (BIE Layer 2, Voyage embeddings) on
  // every turn and splice any hits into the system prompt. It was removed for two independent
  // reasons: the platform is not to depend on BIE, and the call was DARK in production anyway —
  // searchKnowledge returns [] unless VOYAGE_API_KEY is set, and that variable exists nowhere in
  // blackout-infra. So every turn paid a function call and a try/catch to receive an empty array.
  // Largo is grounded by the live feed and its tools, which are real data, not embeddings.
  const knowledgeBlock = "";

  // TEMPORAL RESOLUTION — done in deterministic code BEFORE the model plans.
  //
  // "What did SPX look like at 10:15" otherwise produces a fluent, correctly-sourced, fully
  // grounded answer about the WRONG MOMENT, and every downstream check passes: the numbers are
  // real and they trace to this turn's tool results. Nothing else in the system knows the question
  // was about the past. Resolving the window here, and naming the sources that structurally cannot
  // serve it, turns that from a subtlety the model must notice into a stated constraint.
  //
  // Costs nothing on the fast path: a present-tense question yields an empty block.
  const timeframe = resolveTimeframe(question, Date.now());
  const temporalBlock = formatTemporalBlock(
    timeframe,
    temporalConflicts(timeframe, rankCapabilities(question, LARGO_CAPABILITIES.length))
  );
  // Deliberately NOT pushed into `toolsUsed`. That array is persisted to the interaction log and
  // is what the BIE calibration cohorts bucket turns by, so it must stay a record of TOOLS ACTUALLY
  // CALLED. Temporal resolution is local deterministic work, not a tool call; injecting a token
  // would silently reshape every historical cohort. Diagnostics go to the log instead.
  if (timeframe.historical) {
    console.info(
      `[largo] temporal: ${timeframe.kind} "${timeframe.label}"` +
        (temporalBlock ? ` — ${temporalBlock.split("\n").filter((l) => l.startsWith("- ")).length} source conflict(s)` : "")
    );
  }

  const platformVitalsBlock = await loadLargoPlatformSnapshotBlock().catch(() => "");
  if (platformVitalsBlock) toolsUsed.push("platform_vitals_prefetch");

  const system = buildDynamicSystem(
    question,
    history.slice(0, -1),
    liveFeedBlock + knowledgeBlock + temporalBlock,
    platformVitalsBlock
  );

  resetLargoSpxDeskCache(userId);

  // FULL tool surface, every turn — deliberately NOT filtered by question intent.
  //
  // This used to be `LARGO_TOOL_DEFS.filter(t => getToolsForIntent(question).has(t.name))`, a
  // hand-written regex allowlist deciding which tools Claude was even SHOWN. Measured over 20
  // realistic member questions it exposed a mean of 21.9 / 116 tools (19%), and the failure was
  // silent: "what's the biggest risk in my open positions" reached 4 tools and could not call
  // get_open_plays; "how many trades did we win last month" could not reach get_trade_history or
  // get_zerodte_record. Largo did not decline those — it answered from the live feed alone, which
  // reads as confident and is exactly the "no invented data" failure the system prompt forbids.
  // Every new phrasing a member invents was a new blind spot, and the allowlist could only ever
  // chase them.
  //
  // Sending everything is also the CHEAPER option, which is the counter-intuitive part. The tool
  // block is the first prompt-cache prefix (anthropic.ts marks the last tool with
  // cache_control:ephemeral), so a STATIC list of all 116 defs — 17,025 tokens — is written once
  // and billed at the cache-read rate on every subsequent turn. The old per-question list changed
  // the prefix on nearly every turn, so it never cached: ~5k tokens at FULL price, forever. Static
  // and complete beats dynamic and partial on both capability and cost.
  const filteredTools = LARGO_TOOL_DEFS;

  return { sid, history, system, filteredTools, toolsUsed, tickerHint: intent.tickerHint ?? null };
}


/**
 * Recover the structured answer envelope from a contract-conforming reply, and report drift.
 *
 * Largo writes PROSE to a fixed set of headings so the answer can still STREAM token-by-token;
 * this turns that prose into the envelope the terminal renders as evidence / confidence / conflict
 * / freshness cards. See answer-contract.ts for why the structure is parsed out rather than
 * demanded as a tool-call.
 *
 * Contract misses are LOGGED, never enforced. A hard gate here would mean a member watches a
 * 60-second tool loop and then gets nothing because the model wrote "Summary" instead of
 * "Verdict" — strictly worse than a good answer in an unusual shape. The log line is what makes
 * drift measurable, so the contract can be tightened from evidence instead of guesswork.
 */
function envelopeFromContract(text: string, question: string): BieAnswerEnvelope | undefined {
  const report = validateAnswerContract(text);
  if (!report.conforms) {
    console.warn(
      "[largo] answer-contract miss — missing:",
      report.missing.join(",") || "(none)",
      "present:",
      report.present.join(",") || "(none)",
      "q:",
      question.slice(0, 80)
    );
  }
  return parseAnswerEnvelope(text) ?? undefined;
}

export async function runLargoQuery(
  question: string,
  sessionId: string,
  userId: string
): Promise<{
  answer: string;
  session_id: string;
  source: string;
  tools_used: string[];
  followups: string[];
  verification: ClaimVerification;
  envelope?: BieAnswerEnvelope;
}> {
  const startedAt = Date.now();

  if (!largoClaudeEnabled()) {
    throw new Error("Largo requires Anthropic — not configured in this environment.");
  }

  await prefetchLargoTurnCaches();

  const { sid, history, system, filteredTools, toolsUsed, tickerHint } = await prepareLargoTurn(
    question,
    sessionId,
    userId
  );

  const capturedResults: unknown[] = [];

  try {
    const answer = await anthropicToolLoop({
      system,
      tools: filteredTools,
      messages: history,
      model: LARGO_MODEL,
      maxTokens: 4096,
      maxRounds: 12,
      timeoutMs: 60_000,
      maxRetries: 1,
      cacheSystem: true,
      aiGate: "largo",
      runTool: async (name, input) => {
        toolsUsed.push(name);
        const result = await runLargoTool(name, input, userId);
        capturedResults.push(result);
        return result;
      },
    });

    let text =
      answer?.trim() ||
      "I couldn't pull enough live data to answer that — try naming a ticker or asking about SPX structure.";

    const ctxNumbers = collectContextNumbers([capturedResults, history.map((h) => h.content)]);
    // Verify the PROSE, not the component payloads. Every number inside a ```blackout block also
    // appears in the prose that introduces it, so verifying the raw answer would count each one
    // twice and inflate the coverage ratio that decides whether the member sees the
    // low-confidence caveat — i.e. the richer the answer, the more the honesty check would be
    // diluted, which is exactly backwards.
    const verification = verifyClaims(stripLargoBlocks(text), ctxNumbers);
    text = applyVerificationCaveat(text, verification);

    logClaudeTurn({ userId, question, toolsUsed, verification, startedAt });
    await persistClaudeTurn({ sessionId: sid, userId, question, answer: text, toolsUsed, capturedResults });

    const followups = await generateLargoFollowups(question, text, tickerHint);

    return {
      answer: text,
      session_id: sid,
      source: dbConfigured() ? "blackout-web+postgres" : "blackout-web",
      tools_used: Array.from(new Set(toolsUsed)),
      followups,
      verification,
      envelope: envelopeFromContract(text, question),
    };
  } catch (error) {
    logClaudeTurn({
      userId,
      question,
      toolsUsed,
      verification: { total: 0, verified: 0, coverage: 1, unverified: [] },
      startedAt,
      answerSource: "error",
    });
    throw error;
  } finally {
    resetLargoSpxDeskCache(userId);
  }
}

export async function runLargoQueryStream(
  question: string,
  sessionId: string,
  userId: string,
  onEvent: (event: LargoStreamEvent) => void
): Promise<void> {
  const startedAt = Date.now();
  const emitStatus = (message: string) => {
    try {
      onEvent({ type: "status", message });
    } catch (err) {
      if (isSseClientDisconnect(err)) throw new SseClientDisconnected();
    }
  };

  if (!largoClaudeEnabled()) {
    onEvent({
      type: "error",
      message: "Largo requires Anthropic — not configured in this environment.",
    });
    return;
  }

  await prefetchLargoTurnCaches({ onStatus: emitStatus });

  const { sid, history, system, filteredTools, toolsUsed, tickerHint } = await prepareLargoTurn(
    question,
    sessionId,
    userId
  );
  const capturedResults: unknown[] = [];

  try {
    const emit = (event: LargoStreamEvent) => {
      try {
        onEvent(event);
      } catch (err) {
        if (isSseClientDisconnect(err)) throw new SseClientDisconnected();
        throw err;
      }
    };

    const answer = await anthropicToolLoop({
      system,
      tools: filteredTools,
      messages: history,
      model: LARGO_MODEL,
      maxTokens: 4096,
      maxRounds: 12,
      // Per-round timeout so a single slow round falls back to partial text instead of 500ing (#77 E).
      timeoutMs: 60_000,
      maxRetries: 1,
      // Cache the stable Largo system prompt — saves ~50% on system-token cost for repeat calls.
      cacheSystem: true,
      aiGate: "largo",
      // Forward tool_start only — verified full text emitted once below.
      onEvent: (event) => {
        if (event.type === "tool_start") emit(event);
      },
      runTool: async (name, input) => {
        toolsUsed.push(name);
        const result = await runLargoTool(name, input, userId);
        capturedResults.push(result);
        return result;
      },
    });

    let text =
      answer?.trim() ||
      "I couldn't pull enough live data to answer that — try naming a ticker or asking about SPX structure.";

    // Layer 4 verification: every numeric claim vs the turn's source data (tool
    // results + the history the model was shown). Heavily-unverified answers get
    // an explicit caution — uncertainty stated, never fake precision.
    const ctxNumbers = collectContextNumbers([capturedResults, history.map((h) => h.content)]);
    // Verify the PROSE, not the component payloads. Every number inside a ```blackout block also
    // appears in the prose that introduces it, so verifying the raw answer would count each one
    // twice and inflate the coverage ratio that decides whether the member sees the
    // low-confidence caveat — i.e. the richer the answer, the more the honesty check would be
    // diluted, which is exactly backwards.
    const verification = verifyClaims(stripLargoBlocks(text), ctxNumbers);
    text = applyVerificationCaveat(text, verification);

    logClaudeTurn({ userId, question, toolsUsed, verification, startedAt });
    await persistClaudeTurn({ sessionId: sid, userId, question, answer: text, toolsUsed, capturedResults });

    const followups = await generateLargoFollowups(question, text, tickerHint);

    emit({ type: "token", text } as LargoStreamEvent);
    emit({
      type: "done",
      answer: text,
      session_id: sid,
      source: dbConfigured() ? "blackout-web+postgres" : "blackout-web",
      tools_used: Array.from(new Set(toolsUsed)),
      followups,
      verification,
      envelope: envelopeFromContract(text, question),
    });
  } catch (error) {
    if (isSseClientDisconnect(error)) return;
    const message = error instanceof Error ? error.message : "Largo query failed";
    // Task #165 — same gap as runLargoQuery's try block above, on the streaming path: this
    // catch already existed (it emits an "error" SSE event), but it never called logBie either,
    // so a failed streaming turn was equally invisible to every BIE calibration cohort. Log a
    // minimal failure row — same null-claims rationale as the non-streaming path above — BEFORE
    // emitting the error event, so the write is attempted even if the client has already gone
    // away by the time emit() throws. Purely additive: the error event still fires exactly as
    // before, nothing here changes what the client sees.
    logClaudeTurn({
      userId,
      question,
      toolsUsed,
      verification: { total: 0, verified: 0, coverage: 1, unverified: [] },
      startedAt,
      answerSource: "error",
    });
    try {
      onEvent({ type: "error", message });
    } catch (emitErr) {
      if (!isSseClientDisconnect(emitErr)) throw emitErr;
    }
  } finally {
    resetLargoSpxDeskCache(userId);
  }
}
