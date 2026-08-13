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
import { randomUUID } from "node:crypto";
import { dbConfigured } from "@/lib/db";
import { LARGO_SYSTEM_PROMPT } from "@/lib/largo/system-prompt";
import { LARGO_TOOL_DEFS } from "@/lib/largo/tool-defs";
import { runLargoTool } from "@/lib/largo/run-tool";
import {
  formatToolDiagnostics,
  makeGuardedToolRunner,
  type ToolCallDiagnostic,
  type ToolGuardViewer,
} from "@/lib/largo/core/tool-guard";
import { isAdminUser } from "@/lib/admin-access";
import { prefetchLargoTurnCaches } from "@/lib/largo/turn-pipeline";
import {
  applyVerificationCaveat,
  logClaudeTurn,
  persistClaudeTurn,
} from "@/lib/largo/turn-outcome";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import { parseAnswerEnvelope, validateAnswerContract, fallbackAnswerEnvelope } from "@/lib/largo/answer-contract";
import { sanitizeLargoMemberText } from "@/lib/largo/sanitize-member-text";
import { truncateCapturedResultsForPersist } from "@/lib/largo/persist-tool-results";
import { stripLargoBlocks } from "@/features/largo/blocks/extract";
import { collectContextNumbers, verifyClaims, type ClaimVerification } from "@/lib/bie/verifier";
import { resetLargoSpxDeskCache } from "@/lib/largo/spx-desk-cache";
import {
  appendLargoMessage,
  ensureLargoSession,
  fetchLargoHistory,
  fetchLargoMessagesPublic,
  fetchPreviousUserTurn,
  sessionOwnedByUser,
} from "@/lib/largo/largo-store";
import { analyzeLargoQuestion, KNOWN_TICKERS } from "@/lib/largo/question-intent";
import { formatImageBlock, type ImageBlock } from "@/lib/largo/core/image-attachment";
import { deterministicLargoFollowups } from "@/lib/largo/largo-followups";
import { withResolutionChips } from "@/lib/largo/core/resolution-chips";
import { loadLargoPlatformSnapshotBlock } from "@/lib/largo/platform-snapshot-block";
import { captureLargoLiveFeed, formatLargoLiveFeed } from "@/lib/largo/largo-live-feed";
import { polygonConfigured, uwConfigured } from "@/lib/providers/config";
import { webSearchConfigured } from "@/lib/providers/web-search";
import { todayEtYmd } from "@/lib/providers/spx-session";
import {
  formatCapabilityBlock,
  LARGO_CAPABILITIES,
  rankCapabilities,
} from "@/lib/largo/registry/capability-registry";
import {
  formatTemporalBlock,
  resolveTimeframe,
  temporalConflicts,
  type Timeframe,
} from "@/lib/largo/temporal/timeframe";
import { formatEntityBlock } from "@/lib/largo/core/entities";
import {
  formatEvidenceOntologyBlock,
  formatTradeAnswerBlock,
  isPlayQuestion,
} from "@/lib/largo/core/trade-question";
import { buildDrillDowns, formatDrillDownBlock } from "@/lib/largo/core/drilldown";
import { applyConflictCaveat, findSourceConflicts } from "@/lib/largo/core/cross-source";
import {
  applyEvidenceIntegrityCaveat,
  buildMarketEvidence,
  mergeEvidenceIssues,
} from "@/lib/largo/core/market-evidence";
import {
  applyCoherenceCaveat,
  applyProvenanceCaveat,
  findContradictions,
  findProvenanceLies,
} from "@/lib/largo/core/coherence";
import {
  applyPlanCaveat,
  buildQueryPlan,
  formatPlanBlock,
  validatePlanExecution,
} from "@/lib/largo/core/plan";
import {
  applyConversationToTimeframe,
  buildConversationContext,
  effectiveEntities,
  formatConversationBlock,
} from "@/lib/largo/core/conversation";
import {
  questionWantsCompareCard,
  questionWantsPeerCompare,
  extractPeerCompareTickers,
  questionWantsPlaySimilarity,
  questionWantsPreEarningsPack,
  extractStructuredTicker,
  extractPreEarningsDate,
} from "@/lib/largo/desk-prompts";
import {
  helixThermalCompareForLargo,
  peerTickerCompareForLargo,
  type LargoCompareCard,
} from "@/lib/largo/helix-thermal-compare";
import { playSimilarityForLargo, type PlaySimilarityCard } from "@/lib/largo/play-similarity";
import { preEarningsPackForLargo, type PreEarningsPackCard } from "@/lib/largo/pre-earnings-pack";
import { formatDepthBlock, largoDepthConfig, parseLargoDepth, type LargoDepth } from "@/lib/largo/largo-depth";
import { buildLargoActions, type LargoAction } from "@/lib/largo/largo-actions";
import {
  fetchLargoSessionMetadata,
  maybePersistWatchlistFromQuestion,
  updateLargoSessionMetadata,
} from "@/lib/largo/largo-store";
import {
  formatCalibrationBlock,
  formatMemberContextBlock,
  formatRegimePersonalityBlock,
  recentUserQuestions,
} from "@/lib/largo/member-context";
import {
  formatPlayContextBlock,
  formatWatchlistBlock,
  type LargoPlayContext,
} from "@/lib/largo/session-metadata";
import { marketPhaseFromEt } from "@/lib/largo/core/system-status";
import { getUserTier } from "@/lib/auth-access";

const LARGO_TOOL_LOOP_TIMEOUT_MS = (() => {
  const raw = process.env.LARGO_TOOL_LOOP_TIMEOUT_MS?.trim();
  const n = raw ? Number(raw) : 90_000;
  return Number.isFinite(n) && n >= 30_000 ? Math.min(Math.round(n), 120_000) : 90_000;
})();

const LARGO_TOOL_LOOP_MAX_ROUNDS = (() => {
  const raw = process.env.LARGO_TOOL_LOOP_MAX_ROUNDS?.trim();
  const n = raw ? Number(raw) : 10;
  return Number.isFinite(n) && n >= 4 ? Math.min(Math.round(n), 12) : 10;
})();

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

export type LargoTurnOptions = {
  depth?: LargoDepth;
  /** When true, temporal layer treats the question as explicitly historical. */
  historicalMode?: boolean;
  playContext?: LargoPlayContext | null;
};

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
      verification: ClaimVerification;
      ticker?: string | null;
      turn_id?: number | null;
      envelope?: BieAnswerEnvelope;
      compare_card?: LargoCompareCard | null;
      play_similarity?: PlaySimilarityCard | null;
      pre_earnings_pack?: PreEarningsPackCard | null;
      actions?: LargoAction[];
      depth?: LargoDepth;
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
  platformVitalsBlock: string,
  extraBlocks = ""
): AnthropicSystemBlock[] {
  const intent = analyzeLargoQuestion(question, history);
  const platformSection = platformVitalsBlock.trim()
    ? `\n\n${platformVitalsBlock.trim()}\n`
    : "";
  const dynamicPart = `## This turn

Session date (ET): ${todayEtYmd()}

${liveFeedBlock}${platformSection}${extraBlocks}

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

/**
 * What gets written to `largo_messages` for a turn that carried images.
 *
 * The base64 is NEVER persisted. History is replayed into the prompt on every subsequent turn, so
 * storing the payload would re-bill a 1.5MB screenshot on every later question in the thread and
 * push real conversation out of the window. A marker keeps the transcript coherent — a follow-up
 * "so is that level still holding?" reads correctly against "[1 image attached]" and nonsensically
 * against a user turn that appears to be empty.
 */
function persistedQuestionText(question: string, imageCount: number): string {
  if (imageCount <= 0) return question;
  return `${question}\n\n_[${imageCount} image${imageCount === 1 ? "" : "s"} attached]_`;
}

async function prepareLargoTurn(
  question: string,
  sessionId: string,
  userId: string,
  /** Validated image blocks for this turn — `[]` for a text-only question.
   *  REQUIRED, not defaulted: a defaulted parameter is how the streaming call site silently
   *  dropped every attachment and answered about a chart nobody sent. */
  images: ImageBlock[],
  turnOptions: LargoTurnOptions = {}
): Promise<{
  sid: string;
  history: AnthropicMessage[];
  system: AnthropicSystemBlock[];
  filteredTools: typeof LARGO_TOOL_DEFS;
  toolsUsed: string[];
  liveFeedResults: unknown[];
  tickerHint: string | null;
  viewer: ToolGuardViewer;
  timeframe: Timeframe;
  persistedQuestion: string;
  depth: LargoDepth;
  compareCard: LargoCompareCard | null;
  playSimilarity: PlaySimilarityCard | null;
  preEarningsPack: PreEarningsPackCard | null;
  sessionMetadata: Awaited<ReturnType<typeof fetchLargoSessionMetadata>>;
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
    // crypto.randomUUID, not Math.random: a session id is not a secret (every read is gated on
    // sessionOwnedByUser, so guessing one grants nothing) but it IS the collision key this branch
    // exists to escape, and Math.random tripped CodeQL on every PR that shifted this line.
    sid = `web-${userId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
    await ensureLargoSession(sid, userId);
  }

  const history = await fetchLargoHistory(sid, userId);
  const sessionMetadata = await fetchLargoSessionMetadata(sid, userId);
  const depth = parseLargoDepth(turnOptions.depth ?? sessionMetadata.depth ?? "deep");
  void updateLargoSessionMetadata(sid, userId, { depth }).catch(() => {});
  void maybePersistWatchlistFromQuestion(sid, userId, question).catch(() => {});
  if (turnOptions.playContext?.ticker) {
    void updateLargoSessionMetadata(sid, userId, { play_context: turnOptions.playContext }).catch(
      () => {}
    );
  }
  // Read the previous turn's timestamp BEFORE the current question is appended. Fails soft to
  // null (no DB, first turn, unusable timestamp) — a missing window start is reported as missing.
  const previousTurn = await fetchPreviousUserTurn(sid, userId).catch(() => null);
  // Images ride on THIS turn's user message only, as content blocks ahead of the text. Order is
  // deliberate and is Anthropic's documented guidance: a model that has seen the picture before the
  // instruction answers about the picture. It also survives the tool loop unchanged — anthropic.ts
  // pushes assistant/tool_result turns after this one and never rewrites earlier content.
  history.push(
    images.length
      ? { role: "user", content: [...images, { type: "text", text: question }] }
      : { role: "user", content: question }
  );
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
  // CONVERSATION STATE — resolved before the timeframe, because it supplies the timeframe's
  // missing piece. `resolveTimeframe` recognises "since I last asked" and builds the window with
  // `fromMs: null` and the comment "filled by the caller from conversation state"; this is that
  // caller. Without it, the one question that is EXACTLY answerable (we know to the millisecond
  // when they last asked — it is a row in largo_messages) resolved to an unbounded window and
  // Largo declined it.
  const conversation = buildConversationContext({
    question,
    previousQuestion: previousTurn?.content ?? null,
    previousAskedAtMs: previousTurn?.askedAtMs ?? null,
    known: KNOWN_TICKERS,
  });
  const conversationBlock = formatConversationBlock(conversation);

  const timeframe = applyConversationToTimeframe(resolveTimeframe(question, Date.now()), conversation);
  if (turnOptions.historicalMode && !timeframe.historical) {
    timeframe.historical = true;
    timeframe.label = timeframe.label || "Historical (member-selected)";
  }
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

  // CAPABILITY HINTS — what the tool list cannot express: which sources can reach BACKWARDS.
  //
  // Measured 2026-08-10: asked to "compare today's options flow with yesterday's", Largo declined
  // because "all live flow sources return present-time data only" — honest, and wrong. The
  // platform has get_postgres_flows, catalogued windowed/historical, which covers exactly that.
  // The model had the tool and no way to know it was the past-capable one, because a description
  // says what a tool returns, never whether it can reach a past window.
  //
  // Hints only. All 116 tools stay in the request, so this can never make an answer impossible
  // the way the deleted intent allowlist could.
  const capabilityBlock = formatCapabilityBlock(question, { historical: timeframe.historical });

  // CANONICAL ENTITIES — resolved in code so cross-desk results can actually be joined.
  //
  // The same instrument wears a different name on every surface: SPX on the quote route, I:SPX to
  // Polygon, SPXW on the weekly chain, $SPX when a member types it. Left to the model, "compare
  // Helix and Thermal on SPX" becomes a string comparison, and the two most likely failures are
  // both silent — pooling evidence for two different instruments, or splitting one instrument's
  // evidence across two names so each side looks thinner than it is. Neither shows up in the
  // answer as anything other than confident prose.
  //
  // Purely additive: an empty block when the question names no instrument, and it never
  // constrains which symbols a tool may be called with.
  const entityBlock = formatEntityBlock(effectiveEntities(conversation));
  const ontologyBlock = formatEvidenceOntologyBlock();
  const tradeBlock = isPlayQuestion(question)
    ? formatTradeAnswerBlock(intent.tickerHint)
    : "";

  // SUGGESTED PLAN — composed from what code already resolved (entities, timeframe, ranked
  // capabilities, the registry's DECLARED join edges), handed over as a starting point. It routes
  // nothing and hides nothing; the model may ignore it, and the full 116-tool surface is still in
  // the request. Its real value is telling the model which results can be CORRELATED: a join edge
  // here means the two capabilities share an entity key, which registry.test.ts proves, so a
  // cross-product claim built on one is sound rather than a string coincidence.
  const plan = buildQueryPlan({
    ranked: rankCapabilities(question, 12),
    entities: effectiveEntities(conversation),
    timeframe,
  });
  const planBlock = formatPlanBlock(plan);

  // DRILL-DOWN LINKS — a closed set of routes that provably exist (drilldown.test.ts asserts each
  // against the app router). The model is handed hrefs rather than allowed to compose them,
  // because it has seen `/night-hawk` and `/swings` in this repo's own prose and neither resolves.
  // A dead link makes the whole answer look fabricated, including the parts that were right.
  const drillDownBlock = formatDrillDownBlock(buildDrillDowns(effectiveEntities(conversation)));

  const platformVitalsBlock = await loadLargoPlatformSnapshotBlock().catch(() => "");
  if (platformVitalsBlock) toolsUsed.push("platform_vitals_prefetch");

  const intentTicker = intent.tickerHint ?? "SPX";
  let compareCard: LargoCompareCard | null = null;
  if (questionWantsPeerCompare(question)) {
    const peerTickers = extractPeerCompareTickers(question);
    compareCard = await peerTickerCompareForLargo(peerTickers).catch(() => null);
    if (compareCard) toolsUsed.push("get_peer_ticker_compare");
  } else if (questionWantsCompareCard(question)) {
    compareCard = await helixThermalCompareForLargo(intentTicker).catch(() => null);
    if (compareCard) toolsUsed.push("get_helix_thermal_compare");
  }

  let playSimilarity: PlaySimilarityCard | null = null;
  if (questionWantsPlaySimilarity(question)) {
    const simTicker = extractStructuredTicker(question, intentTicker ?? "NVDA");
    playSimilarity = await playSimilarityForLargo(simTicker).catch(() => null);
    if (playSimilarity) toolsUsed.push("get_play_similarity");
  }

  let preEarningsPack: PreEarningsPackCard | null = null;
  if (questionWantsPreEarningsPack(question)) {
    const earnTicker = extractStructuredTicker(question, intentTicker ?? "NVDA");
    preEarningsPack = await preEarningsPackForLargo(earnTicker, extractPreEarningsDate(question)).catch(
      () => null
    );
    if (preEarningsPack) toolsUsed.push("get_pre_earnings_pack");
  }

  const now = new Date();
  const et = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);
  const part = (t: string) => et.find((p) => p.type === t)?.value ?? "";
  const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const marketPhase = marketPhaseFromEt(DAYS[part("weekday")] ?? 1, Number(part("hour")) * 60 + Number(part("minute")));

  const tier = await getUserTier(userId).catch(() => null);
  const isAdmin = await isAdminUser(userId).catch(() => false);
  const extraBlocks =
    formatDepthBlock(depth) +
    formatWatchlistBlock(sessionMetadata.watchlist) +
    formatPlayContextBlock(turnOptions.playContext ?? sessionMetadata.play_context) +
    formatMemberContextBlock({
      tier,
      isAdmin,
      recentQuestions: recentUserQuestions(history.slice(0, -1)),
      watchlist: sessionMetadata.watchlist,
    }) +
    formatRegimePersonalityBlock(marketPhase) +
    formatCalibrationBlock() +
    (compareCard
      ? compareCard.kind === "peer_tickers"
        ? `\n\n## Peer ticker compare (prefetched — cite these numbers)\n${JSON.stringify(compareCard, null, 0).slice(0, 5000)}\n`
        : `\n\n## HELIX vs Thermal (prefetched — cite these numbers)\n${JSON.stringify(compareCard, null, 0).slice(0, 4000)}\n`
      : "") +
    (playSimilarity
      ? `\n\n## Play similarity (prefetched — cite distribution, not a single win rate)\n${JSON.stringify(playSimilarity, null, 0).slice(0, 5000)}\n`
      : "") +
    (preEarningsPack
      ? `\n\n## Pre-earnings desk pack (prefetched — cite these numbers)\n${JSON.stringify(preEarningsPack, null, 0).slice(0, 5000)}\n`
      : "");

  const system = buildDynamicSystem(
    question,
    history.slice(0, -1),
    liveFeedBlock + knowledgeBlock + temporalBlock + capabilityBlock + entityBlock + ontologyBlock + tradeBlock + conversationBlock + planBlock + drillDownBlock + formatImageBlock(images.length),
    platformVitalsBlock,
    extraBlocks
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

  // Entitlement is resolved ONCE per turn, not per tool call — a 12-round loop would otherwise
  // make up to 12 Clerk reads for an answer that cannot change mid-turn. Fails CLOSED to
  // non-admin: if we cannot establish that someone is an admin, they are not treated as one.
  const isAdminViewer = isAdmin;

  return {
    sid,
    history,
    system,
    filteredTools,
    toolsUsed,
    liveFeedResults: Object.values(liveFeed).filter((v) => v != null),
    tickerHint: intent.tickerHint ?? null,
    viewer: { userId, isAdmin: isAdminViewer },
    timeframe,
    persistedQuestion: persistedQuestionText(question, images.length),
    depth,
    compareCard,
    playSimilarity,
    preEarningsPack,
    sessionMetadata,
  };
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
function envelopeFromContract(
  text: string,
  question: string,
  /** The turn's raw tool results — carries structured blocks (GEX shifts) the prose flattened. */
  capturedResults?: readonly unknown[],
  marketEvidence?: ReturnType<typeof buildMarketEvidence>
): BieAnswerEnvelope | undefined {
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
  return parseAnswerEnvelope(text, capturedResults, marketEvidence ?? undefined, question)
    ?? fallbackAnswerEnvelope(text)
    ?? undefined;
}

/** Post-synthesis integrity: canonical evidence + fail-closed gates on spot disagreement. */
function applyMarketEvidenceGates(
  text: string,
  capturedResults: readonly unknown[],
  tickerHint: string | null,
  startedAt: number
): { text: string; marketEvidence: ReturnType<typeof buildMarketEvidence> } {
  let marketEvidence = buildMarketEvidence(capturedResults, tickerHint, todayEtYmd(), startedAt);
  if (!marketEvidence) return { text, marketEvidence: null };
  marketEvidence = mergeEvidenceIssues(marketEvidence, text);
  if (marketEvidence.issues.length) {
    console.warn(`[largo] market-evidence: ${marketEvidence.issues.map((i) => i.code).join(",")}`);
  }
  return { text: applyEvidenceIntegrityCaveat(text, marketEvidence), marketEvidence };
}


export async function runLargoQuery(
  question: string,
  sessionId: string,
  userId: string,
  /** Validated image blocks for this turn — `[]` for a text-only question.
   *  REQUIRED, not defaulted: a defaulted parameter is how the streaming call site silently
   *  dropped every attachment and answered about a chart nobody sent. */
  images: ImageBlock[],
  turnOptions: LargoTurnOptions = {}
): Promise<{
  answer: string;
  session_id: string;
  source: string;
  tools_used: string[];
  followups: string[];
  verification: ClaimVerification;
  ticker: string | null;
  turn_id: number | null;
  envelope?: BieAnswerEnvelope;
  compare_card?: LargoCompareCard | null;
  play_similarity?: PlaySimilarityCard | null;
  pre_earnings_pack?: PreEarningsPackCard | null;
  actions?: LargoAction[];
  depth?: LargoDepth;
}> {
  const startedAt = Date.now();

  if (!largoClaudeEnabled()) {
    throw new Error("Largo requires Anthropic — not configured in this environment.");
  }

  await prefetchLargoTurnCaches();

  const {
    sid, history, system, filteredTools, toolsUsed, tickerHint, viewer, timeframe, persistedQuestion,
    liveFeedResults, depth, compareCard, playSimilarity, preEarningsPack,
  } = await prepareLargoTurn(
    question,
    sessionId,
    userId,
    images,
    turnOptions
  );

  const depthCfg = largoDepthConfig(depth);
  const capturedResults: unknown[] = [];
  // Per-tool timings/outcomes for the turn. Names, ms and byte counts only — never inputs or
  // outputs, which carry tickers, user ids and the member's positions.
  const diagnostics: ToolCallDiagnostic[] = [];

  try {
    const answer = await anthropicToolLoop({
      system,
      tools: filteredTools,
      messages: history,
      model: depthCfg.model,
      maxTokens: depthCfg.maxTokens,
      maxRounds: depthCfg.maxRounds,
      timeoutMs: depthCfg.timeoutMs,
      maxRetries: 1,
      cacheSystem: true,
      aiGate: "largo",
      runTool: makeGuardedToolRunner({
        viewer,
        execute: runLargoTool,
        toolsUsed,
        capturedResults,
        diagnostics,
      }),
    });

    // APPENDED, NOT PREPENDED. The extractors take the first match, so anything the model
    // explicitly called still wins and the feed can only fill gaps. See `liveFeedResults`.
    capturedResults.push(...liveFeedResults);

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

    // POST-LOOP PLAN VALIDATION. The temporal block WARNS the model before the loop; this checks
    // after, which is the difference between an instruction and a control. It catches the one
    // failure with no other detector: a question about a past moment answered entirely from
    // live-only sources. Every existing check passes on that answer — the number is real, it
    // traces to this turn's tool results, grounding is 1.0 — and it is about the wrong moment.
    // Caveat appended, answer never suppressed: the member decides whether it is still useful.
    const planCheck = validatePlanExecution({ timeframe, toolsCalled: toolsUsed, catalogue: LARGO_CAPABILITIES });
    if (!planCheck.ok) {
      console.warn(`[largo] plan violation: ${planCheck.violations.map((v) => v.code).join(",")}`);
      text = applyPlanCaveat(text, planCheck.violations);
    }

    // SELF-CONTRADICTION. Measured live: a verdict reading "there are no open plays… nothing is
    // live" sat four lines above facts reporting 20 open positions and 13 committed. Every other
    // check passed — the numbers were real and traceable, the contract conformed, grounding was
    // 1.0 — because nothing compared the answer's CONCLUSION against its own EVIDENCE.
    const contradictions = findContradictions(text);
    if (contradictions.length) {
      console.warn(`[largo] self-contradiction: verdict vs facts on "${contradictions[0]!.noun}"`);
      text = applyCoherenceCaveat(text, contradictions);
    }

    // IMPOSSIBLE PROVENANCE. Measured live: a 34.7% win rate over 123 graded plays stamped
    // "(Polygon · live)". Polygon prices instruments; it does not know which trades we recommended
    // or how they were graded — that is our own ledger. The figure was right and the attribution
    // was impossible, which is worse than an unstamped number: it makes an internal figure look
    // independently verified.
    // CROSS-SOURCE CONFLICT. Several tools carry a spot for the same instrument; when one serves a
    // cached snapshot they disagree, and every number stays real, traceable and grounded. The
    // answer's own evidence then contains the contradiction and presents both with equal
    // confidence. This is the caller `reconcile` was written for and never had.
    const sourceConflicts = findSourceConflicts(capturedResults);
    if (sourceConflicts.length) {
      console.warn(
        `[largo] source conflict: ${sourceConflicts[0]!.ticker} spread ${sourceConflicts[0]!.spreadPct.toFixed(2)}%`
      );
      text = applyConflictCaveat(text, sourceConflicts);
    }

    const provenanceLies = findProvenanceLies(text);
    if (provenanceLies.length) {
      console.warn(`[largo] impossible provenance: ${provenanceLies.map((l) => l.source).join(",")}`);
      text = applyProvenanceCaveat(text, provenanceLies);
    }

    const { text: gatedText, marketEvidence } = applyMarketEvidenceGates(
      text,
      capturedResults,
      tickerHint,
      startedAt
    );
    text = sanitizeLargoMemberText(gatedText);

    // Per-tool timing summary. Turns "Largo is slow" into "get_postgres_flows took 9.2s of an 11s
    // turn" — a question with an answer. Also surfaces DENIED and silently-EMPTY tool results,
    // neither of which is visible in `toolsUsed` alone.
    const diagLine = formatToolDiagnostics(diagnostics);
    if (diagLine) console.info(diagLine);
    logClaudeTurn({ userId, question, toolsUsed, verification, startedAt });
    let turnId: number | null = null;
    try {
      turnId = await persistClaudeTurn({
        sessionId: sid,
        userId,
        question: persistedQuestion,
        answer: text,
        toolsUsed,
        capturedResults: truncateCapturedResultsForPersist(capturedResults),
      });
    } catch (err) {
      console.warn(
        "[largo] persist turn failed — returning answer anyway:",
        err instanceof Error ? err.message : String(err)
      );
    }

    // The envelope is built BEFORE the follow-ups so the chips can be derived from the same
    // headline the badge renders. Deriving them from the raw answer instead would read the whole
    // body — where a long answer naturally names both directions — and report MIXED on answers
    // that resolved cleanly. Chips and badge now agree by construction.
    const envelope = envelopeFromContract(text, question, capturedResults, marketEvidence);
    // The turn id rides on the envelope so a follow-up can name the exact turn it refers to.
    if (envelope && turnId != null) envelope.turnId = turnId;
    const followups = withResolutionChips(
      await generateLargoFollowups(question, text, tickerHint),
      envelope?.headline ?? ""
    );
    const actions = buildLargoActions({ ticker: tickerHint, envelope, compareCard });

    return {
      answer: text,
      session_id: sid,
      source: dbConfigured() ? "blackout-web+postgres" : "blackout-web",
      tools_used: Array.from(new Set(toolsUsed)),
      followups,
      verification,
      ticker: tickerHint,
      turn_id: turnId ?? null,
      envelope,
      compare_card: compareCard,
      play_similarity: playSimilarity,
      pre_earnings_pack: preEarningsPack,
      actions,
      depth,
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
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("Largo requires Anthropic")) throw error;
    console.error("[largo/runLargoQuery]", error);
    const fallback =
      "**Verdict** — I hit an internal error before I could finish this answer.\n\n" +
      "**Data** — The desk tools did not complete cleanly this turn. Retry in a moment, or ask a narrower question (one ticker or one desk).";
    console.error("[largo/runLargoQuery] detail:", msg.slice(0, 300));
    const envelope = fallbackAnswerEnvelope(fallback) ?? undefined;
    return {
      answer: sanitizeLargoMemberText(fallback),
      session_id: sid,
      source: dbConfigured() ? "blackout-web+postgres" : "blackout-web",
      tools_used: Array.from(new Set(toolsUsed)),
      followups: deterministicLargoFollowups(question, tickerHint).slice(0, 3),
      verification: { total: 0, verified: 0, coverage: 1, unverified: [] },
      ticker: tickerHint,
      turn_id: null,
      envelope,
    };
  } finally {
    resetLargoSpxDeskCache(userId);
  }
}

export async function runLargoQueryStream(
  question: string,
  sessionId: string,
  userId: string,
  onEvent: (event: LargoStreamEvent) => void,
  /** Validated image blocks for this turn — `[]` for a text-only question. Required for the
   *  same reason as runLargoQuery's: see that signature. */
  images: ImageBlock[],
  turnOptions: LargoTurnOptions = {}
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

  const {
    sid, history, system, filteredTools, toolsUsed, tickerHint, viewer, timeframe, persistedQuestion,
    liveFeedResults, depth, compareCard, playSimilarity, preEarningsPack,
  } = await prepareLargoTurn(
    question,
    sessionId,
    userId,
    images,
    turnOptions
  );
  const depthCfg = largoDepthConfig(depth);
  const capturedResults: unknown[] = [];
  // Per-tool timings/outcomes for the turn. Names, ms and byte counts only — never inputs or
  // outputs, which carry tickers, user ids and the member's positions.
  const diagnostics: ToolCallDiagnostic[] = [];

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
      model: depthCfg.model,
      maxTokens: depthCfg.maxTokens,
      maxRounds: depthCfg.maxRounds,
      timeoutMs: depthCfg.timeoutMs,
      maxRetries: 1,
      cacheSystem: true,
      aiGate: "largo",
      // PROGRESSIVE ANSWER. Tokens are forwarded as the model writes, so the member watches the
      // answer appear instead of staring at a spinner for 20s while 12 rounds of tools resolve.
      //
      // The streamed text is PROVISIONAL and the client must replace it with the `done` event's
      // answer, never append to it. That is not a nicety: the final text is the only one that has
      // been through verifyClaims/applyVerificationCaveat and the plan-timeframe caveat, so a
      // member reading only the stream could act on an unverified number whose caveat never
      // arrived. useLargoChat already replaces (upsertAssistantMessage with res.answer).
      //
      // answer_reset fires when a round ended in tool calls, meaning what it streamed was the
      // model narrating its plan rather than answering. Without it the buffer would render that
      // chatter glued to the front of the real answer.
      onEvent: (event) => {
        if (event.type === "tool_start" || event.type === "token" || event.type === "answer_reset") {
          emit(event);
        }
      },
      runTool: makeGuardedToolRunner({
        viewer,
        execute: runLargoTool,
        toolsUsed,
        capturedResults,
        diagnostics,
      }),
    });

    // APPENDED, NOT PREPENDED. The extractors take the first match, so anything the model
    // explicitly called still wins and the feed can only fill gaps. See `liveFeedResults`.
    capturedResults.push(...liveFeedResults);

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

    // POST-LOOP PLAN VALIDATION. The temporal block WARNS the model before the loop; this checks
    // after, which is the difference between an instruction and a control. It catches the one
    // failure with no other detector: a question about a past moment answered entirely from
    // live-only sources. Every existing check passes on that answer — the number is real, it
    // traces to this turn's tool results, grounding is 1.0 — and it is about the wrong moment.
    // Caveat appended, answer never suppressed: the member decides whether it is still useful.
    const planCheck = validatePlanExecution({ timeframe, toolsCalled: toolsUsed, catalogue: LARGO_CAPABILITIES });
    if (!planCheck.ok) {
      console.warn(`[largo] plan violation: ${planCheck.violations.map((v) => v.code).join(",")}`);
      text = applyPlanCaveat(text, planCheck.violations);
    }

    // SELF-CONTRADICTION. Measured live: a verdict reading "there are no open plays… nothing is
    // live" sat four lines above facts reporting 20 open positions and 13 committed. Every other
    // check passed — the numbers were real and traceable, the contract conformed, grounding was
    // 1.0 — because nothing compared the answer's CONCLUSION against its own EVIDENCE.
    const contradictions = findContradictions(text);
    if (contradictions.length) {
      console.warn(`[largo] self-contradiction: verdict vs facts on "${contradictions[0]!.noun}"`);
      text = applyCoherenceCaveat(text, contradictions);
    }

    // IMPOSSIBLE PROVENANCE. Measured live: a 34.7% win rate over 123 graded plays stamped
    // "(Polygon · live)". Polygon prices instruments; it does not know which trades we recommended
    // or how they were graded — that is our own ledger. The figure was right and the attribution
    // was impossible, which is worse than an unstamped number: it makes an internal figure look
    // independently verified.
    // CROSS-SOURCE CONFLICT. Several tools carry a spot for the same instrument; when one serves a
    // cached snapshot they disagree, and every number stays real, traceable and grounded. The
    // answer's own evidence then contains the contradiction and presents both with equal
    // confidence. This is the caller `reconcile` was written for and never had.
    const sourceConflicts = findSourceConflicts(capturedResults);
    if (sourceConflicts.length) {
      console.warn(
        `[largo] source conflict: ${sourceConflicts[0]!.ticker} spread ${sourceConflicts[0]!.spreadPct.toFixed(2)}%`
      );
      text = applyConflictCaveat(text, sourceConflicts);
    }

    const provenanceLies = findProvenanceLies(text);
    if (provenanceLies.length) {
      console.warn(`[largo] impossible provenance: ${provenanceLies.map((l) => l.source).join(",")}`);
      text = applyProvenanceCaveat(text, provenanceLies);
    }

    const { text: gatedText, marketEvidence } = applyMarketEvidenceGates(
      text,
      capturedResults,
      tickerHint,
      startedAt
    );
    text = sanitizeLargoMemberText(gatedText);

    // Per-tool timing summary. Turns "Largo is slow" into "get_postgres_flows took 9.2s of an 11s
    // turn" — a question with an answer. Also surfaces DENIED and silently-EMPTY tool results,
    // neither of which is visible in `toolsUsed` alone.
    const diagLine = formatToolDiagnostics(diagnostics);
    if (diagLine) console.info(diagLine);
    logClaudeTurn({ userId, question, toolsUsed, verification, startedAt });
    let turnId: number | null = null;
    try {
      turnId = await persistClaudeTurn({
        sessionId: sid,
        userId,
        question: persistedQuestion,
        answer: text,
        toolsUsed,
        capturedResults: truncateCapturedResultsForPersist(capturedResults),
      });
    } catch (err) {
      console.warn(
        "[largo] persist turn failed — returning answer anyway:",
        err instanceof Error ? err.message : String(err)
      );
    }

    // The envelope is built BEFORE the follow-ups so the chips can be derived from the same
    // headline the badge renders. Deriving them from the raw answer instead would read the whole
    // body — where a long answer naturally names both directions — and report MIXED on answers
    // that resolved cleanly. Chips and badge now agree by construction.
    const envelope = envelopeFromContract(text, question, capturedResults, marketEvidence);
    // The turn id rides on the envelope so a follow-up can name the exact turn it refers to.
    if (envelope && turnId != null) envelope.turnId = turnId;
    const followups = withResolutionChips(
      await generateLargoFollowups(question, text, tickerHint),
      envelope?.headline ?? ""
    );
    const actions = buildLargoActions({ ticker: tickerHint, envelope, compareCard });

    emit({ type: "answer_reset" } as LargoStreamEvent);
    emit({ type: "token", text } as LargoStreamEvent);
    emit({
      type: "done",
      answer: text,
      session_id: sid,
      source: dbConfigured() ? "blackout-web+postgres" : "blackout-web",
      tools_used: Array.from(new Set(toolsUsed)),
      followups,
      ticker: tickerHint,
      turn_id: turnId ?? null,
      verification,
      envelope,
      compare_card: compareCard,
      play_similarity: playSimilarity,
      pre_earnings_pack: preEarningsPack,
      actions,
      depth,
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
