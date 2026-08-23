import { type ClaimVerification, LARGO_RUNTIME_CAUTION_MARKER } from "@/lib/bie/verifier";
import { dbConfigured, insertBieInteraction } from "@/lib/db";
import { appendLargoMessage } from "@/lib/largo/largo-store";

/**
 * Every Largo turn is a Claude tool-loop turn, so the interaction log's `intent_bucket` is always
 * this one value. It used to come from `bieIntentBucket(null)`, whose entire body was
 * `intent ?? "claude_fallback"` — a function call to read a default. Inlined so the last
 * runtime dependency on the BIE router could be deleted, and named as a constant so the
 * historical rows (which the calibration cohorts in bie/calibration.ts still bucket by this exact
 * string) keep matching.
 */
const CLAUDE_TURN_BUCKET = "claude_fallback";

/**
 * Append the grounding caveat — as a BLOCKQUOTE, because that is what the terminal renders.
 *
 * IT USED TO EMIT ITALIC PROSE (`_Data check: …_`) AND THEREFORE NEVER RENDERED AS A CAVEAT AT ALL.
 * Every other honesty caveat in this pipeline — coherence, provenance, source-conflict, integrity,
 * timeframe — is emitted as a trailing `> **Heading.**` block, and `splitAnswerCaveats` collects
 * exactly those, peels them off the body and hands them to `<LargoAnswerCaveats>` as labelled
 * callouts. Italic prose matches nothing, so it stayed buried mid-answer as ordinary text.
 *
 * The UI has had the `verification` kind, its regex and its "Grounding note" label wired end to end
 * the whole time; nothing in the codebase ever produced the string they were waiting for. Measured
 * before the fix: this function's output classified as `kinds=[]` — not even split off as a caveat.
 *
 * That mattered more here than anywhere else. This is the one caveat that says the answer's own
 * NUMBERS could not be traced to data pulled this turn — the single signal a member most needs to
 * see set apart from the prose, and the only one that was not.
 *
 * The heading is built from `LARGO_RUNTIME_CAUTION_MARKER` rather than written out, because the
 * cron auditor keys "already disclosed" off that same constant. Hand-keeping the two is what broke
 * both of them.
 */
export function applyVerificationCaveat(text: string, verification: ClaimVerification): string {
  if (verification.total >= 4 && verification.coverage != null && verification.coverage < 0.5) {
    const unverified = verification.total - verification.verified;
    return (
      text +
      `\n\n> **${LARGO_RUNTIME_CAUTION_MARKER}.** ${unverified} of ${verification.total} figures in this ` +
      `answer could not be traced to data pulled this turn — treat those specific numbers with caution.`
    );
  }
  return text;
}

function logBieInteraction(row: {
  user_id: string | null;
  question: string;
  intent: string | null;
  answer_source: string;
  claims_total: number | null;
  claims_verified: number | null;
  latency_ms: number | null;
  tools_used: string[];
  intent_bucket: string;
}): void {
  if (!dbConfigured()) return;
  void insertBieInteraction(row).catch(() => {});
}

export function logClaudeTurn(params: {
  userId: string;
  question: string;
  toolsUsed: string[];
  verification: ClaimVerification;
  startedAt: number;
  answerSource?: "claude" | "error";
}): void {
  logBieInteraction({
    user_id: params.userId,
    question: params.question,
    intent: null,
    answer_source: params.answerSource ?? "claude",
    claims_total: params.answerSource === "error" ? null : params.verification.total,
    claims_verified: params.answerSource === "error" ? null : params.verification.verified,
    latency_ms: Date.now() - params.startedAt,
    tools_used: Array.from(new Set(params.toolsUsed)),
    intent_bucket: CLAUDE_TURN_BUCKET,
  });
}

export async function persistClaudeTurn(params: {
  sessionId: string;
  userId: string;
  question: string;
  answer: string;
  toolsUsed: string[];
  capturedResults: unknown[];
  /** The assistant row's id, so the caller can offer a visual built from THIS turn's evidence. */
}): Promise<number | null> {
  const sid = params.sessionId.trim() || `web-${params.userId}-${Date.now()}`;
  const tools = Array.from(new Set(params.toolsUsed));
  await appendLargoMessage(sid, params.userId, "user", params.question);
  return appendLargoMessage(sid, params.userId, "assistant", params.answer, tools, params.capturedResults);
}
