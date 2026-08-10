/**
 * CONVERSATION INTELLIGENCE — the state a single question does not carry.
 *
 * Two failures this closes, both measured rather than imagined:
 *
 *  1. **"Since I last asked" had no start.** The temporal layer already recognises that phrasing
 *     and builds a window — with `fromMs: null` and the comment "filled by the caller from
 *     conversation state". Nothing filled it. So the one question in the language that is
 *     *exactly* answerable (we know precisely when the member last asked; it is a row in
 *     `largo_messages`) resolved to an unbounded window and Largo had to say it could not tell.
 *
 *  2. **A follow-up dropped its subject.** "What about puts?" after a question about NVDA carries
 *     no ticker. The entity layer correctly extracts nothing, and the turn plans against the whole
 *     market. Worse is the near miss: the model infers a subject from the history text and picks
 *     the wrong one, which is indistinguishable from a correct answer.
 *
 * WHY CARRY-FORWARD IS NARROW. An entity is inherited ONLY when the current question names none
 * and reads as a continuation. A question that names its own subject is never overridden — that
 * would let a stale ticker outrank what the member just typed, which is a far worse failure than
 * planning broadly. Every inheritance is stated in the prompt block so the model can contradict it
 * ("you asked about puts — I assumed NVDA") rather than silently acting on it.
 *
 * PURE AND TOTAL: no IO, no clock, no throw. Timestamps arrive as arguments.
 */

import { extractTickers, type CanonicalTicker } from "./entities";
import type { Timeframe } from "@/lib/largo/temporal/timeframe";

export type ConversationContext = {
  /** The member's previous question in this session, verbatim. Null on the first turn. */
  previousQuestion: string | null;
  /** When they asked it, epoch ms. Null when unknown — never guessed. */
  previousAskedAtMs: number | null;
  /** Entities named in THIS question. */
  entities: CanonicalTicker[];
  /** Entities inherited from the previous question because this one named none. */
  carried: CanonicalTicker[];
  isFollowUp: boolean;
  /** Why it was classified a follow-up — surfaced so a wrong call is debuggable, not mysterious. */
  followUpReason: string | null;
};

/**
 * Openers and shapes that only make sense as a continuation.
 *
 * Deliberately conservative. Misclassifying a fresh question as a follow-up imports a stale
 * subject; misclassifying a follow-up as fresh merely plans broadly. The asymmetry decides every
 * borderline case here.
 */
const FOLLOWUP_OPENERS =
  /^\s*(?:and\b|but\b|so\b|what\s+about\b|how\s+about\b|why\b|why\s+not\b|then\b|ok(?:ay)?\b|also\b|same\s+for\b|what\s+if\b)/i;

/** A bare pronoun with no antecedent in the sentence. "it", "that", "those", "them", "this one". */
const BARE_PRONOUN = /\b(?:it|its|that|those|these|them|they|this\s+one|the\s+(?:first|second|third|last)\s+one)\b/i;

const SINCE_LAST_ASKED = /\bsince\s+(?:i\s+)?(?:last\s+)?asked\b|\bsince\s+my\s+last\s+question\b|\bsince\s+we\s+(?:last\s+)?(?:spoke|talked)\b/i;

/** Does the question reference the previous exchange as its start point? */
export function referencesLastExchange(question: string): boolean {
  return SINCE_LAST_ASKED.test(question ?? "");
}

export function buildConversationContext(input: {
  question: string;
  previousQuestion: string | null;
  previousAskedAtMs: number | null;
  known: ReadonlySet<string>;
}): ConversationContext {
  const question = input.question ?? "";
  const entities = extractTickers(question, input.known);

  let isFollowUp = false;
  let followUpReason: string | null = null;
  if (input.previousQuestion) {
    if (FOLLOWUP_OPENERS.test(question)) {
      isFollowUp = true;
      followUpReason = "opens as a continuation";
    } else if (BARE_PRONOUN.test(question) && entities.length === 0) {
      // A pronoun WITH an entity ("is it above the NVDA wall") has its antecedent in the sentence.
      isFollowUp = true;
      followUpReason = "refers to something by pronoun with no subject of its own";
    } else if (referencesLastExchange(question)) {
      isFollowUp = true;
      followUpReason = "names the previous exchange as its start point";
    } else if (question.trim().split(/\s+/).length <= 4 && entities.length === 0) {
      // "and puts?", "why?", "the other side?" — too short to stand alone.
      isFollowUp = true;
      followUpReason = "too short to stand alone";
    }
  }

  // Inherit ONLY into a vacuum. A question that named its own subject keeps it.
  const carried =
    isFollowUp && entities.length === 0 && input.previousQuestion
      ? extractTickers(input.previousQuestion, input.known)
      : [];

  return {
    previousQuestion: input.previousQuestion,
    previousAskedAtMs: input.previousAskedAtMs,
    entities,
    carried,
    isFollowUp,
    followUpReason,
  };
}

/**
 * Fill the start of a "since I last asked" window from conversation state.
 *
 * This is the caller the temporal layer's `fromMs: null` comment was waiting for. Returns the
 * timeframe UNCHANGED when the start is genuinely unknown — the temporal block then tells the
 * model to say so rather than assume one, which stays the right behaviour on the first turn of a
 * session or when the row carries no usable timestamp.
 */
export function applyConversationToTimeframe(tf: Timeframe, ctx: ConversationContext): Timeframe {
  if (tf.fromMs != null) return tf;
  if (!referencesLastExchange(tf.matched ?? "") && !/last question/i.test(tf.label)) return tf;
  const from = ctx.previousAskedAtMs;
  if (from == null || !Number.isFinite(from) || from > (tf.toMs ?? from)) return tf;
  return { ...tf, fromMs: from, label: `since your last question (${new Date(from).toISOString()})` };
}

/** Entities the turn should plan against: what was asked for, else what was inherited. */
export function effectiveEntities(ctx: ConversationContext): CanonicalTicker[] {
  return ctx.entities.length ? ctx.entities : ctx.carried;
}

/**
 * The conversation digest for the system prompt.
 *
 * Empty on a standalone question — most turns pay nothing. When it does fire, every inference is
 * stated as an assumption the model is told to surface, not as a fact. An inherited subject the
 * member did not intend is recoverable if the answer says "assuming you still mean NVDA"; it is
 * not recoverable if the answer just talks about NVDA.
 */
export function formatConversationBlock(ctx: ConversationContext): string {
  if (!ctx.isFollowUp && ctx.carried.length === 0) return "";
  const lines = ["\n\n## Conversation state"];
  if (ctx.previousQuestion) {
    lines.push(`The member's previous question was: "${ctx.previousQuestion.slice(0, 240)}"`);
  }
  if (ctx.followUpReason) {
    lines.push(`This turn reads as a follow-up (${ctx.followUpReason}).`);
  }
  if (ctx.carried.length) {
    lines.push(
      `It names no instrument, so the subject is carried forward: ${ctx.carried.map((e) => e.key).join(", ")}.`,
      `State that assumption in your answer so the member can correct it if it is wrong.`
    );
  }
  if (ctx.previousAskedAtMs != null) {
    lines.push(
      `They last asked at ${new Date(ctx.previousAskedAtMs).toISOString()} — that is the start of any "since I last asked" window.`
    );
  } else if (referencesLastExchange(ctx.previousQuestion ?? "") || ctx.isFollowUp) {
    lines.push(
      `The time of their previous question is not recorded, so a "since I last asked" window has no start — say so rather than assuming one.`
    );
  }
  return lines.join("\n");
}
