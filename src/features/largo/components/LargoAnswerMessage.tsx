"use client";

import { Component, useMemo, type ReactNode } from "react";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { LargoCompareCard as LargoCompareCardPayload } from "@/lib/largo/compare-card-types";
import type { PlaySimilarityCard } from "@/lib/largo/play-similarity";
import type { PreEarningsPackCard } from "@/lib/largo/pre-earnings-pack";
import type { LargoAction } from "@/lib/largo/largo-actions";
import { LargoMessageBody } from "@/features/largo/components/LargoMessageBody";
import { LargoStructuredCards } from "@/features/largo/components/LargoStructuredCards";
import { LargoActionsBar } from "@/features/largo/components/LargoActionsBar";
import { LargoShareRow } from "@/features/largo/components/LargoShareRow";
import { LargoFollowupChips } from "@/features/largo/components/LargoFollowupChips";
import { BieAnswer } from "@/features/largo/answer/BieAnswer";
import { LargoDeskRead } from "@/features/largo/answer/LargoDeskRead";
import { LargoAnswerCaveats } from "@/features/largo/answer/LargoAnswerCaveats";
import { splitAnswerCaveats } from "@/features/largo/answer/answer-caveats";
import { largoAnswerToEnvelope } from "@/features/largo/answer/answer-format";
import { proseSections } from "@/features/largo/answer/section-policy";
import { BieScenarioCards } from "@/features/largo/answer/BieScenarioCards";
import { questionWantsSocialContentPack } from "@/lib/largo/desk-prompts";

function wantsLargoShareRow(
  streaming: boolean,
  content: string,
  question?: string | null,
): boolean {
  if (streaming || !content.trim()) return false;
  if (questionWantsSocialContentPack(question ?? "")) return true;
  return /(?:^|\n)(?:#+\s*Post\b|\*\*Post\*\*)/i.test(content);
}

/**
 * Renders a COMPLETED Largo assistant turn through the rich <BieAnswer> surface
 * (task #64 PR 3). Prefers a real `envelope` when one is available (forward-compat
 * with synthesis #59, which will make the query API return a populated
 * BieAnswerEnvelope); otherwise falls back to the transition shim
 * `largoAnswerToEnvelope`, which wraps the current `{answer, source}` markdown
 * string in a valid envelope. It lights up richer automatically once #59 lands —
 * no further UI change.
 *
 * Two guarantees:
 *  1. While STREAMING, the partial is rendered as plain markdown; we only swap to
 *     the structured card once the full answer is in (never parse a half-answer).
 *  2. If envelope construction or rich rendering throws, we degrade to the raw
 *     markdown string — a member never sees a broken card.
 */
export function LargoAnswerMessage({
  content,
  source,
  createdAt,
  envelope,
  streaming = false,
  className,
  onFollowup,
  question,
  turnId,
  compareCard,
  playSimilarity,
  preEarningsPack,
  actions,
  sessionId,
  ticker,
  followups,
  nativeFollowups = false,
}: {
  content: string;
  source?: string | null;
  createdAt?: string | null;
  envelope?: BieAnswerEnvelope | null;
  streaming?: boolean;
  className?: string;
  onFollowup?: (q: string) => void;
  question?: string | null;
  turnId?: number | null;
  compareCard?: LargoCompareCardPayload | null;
  playSimilarity?: PlaySimilarityCard | null;
  preEarningsPack?: PreEarningsPackCard | null;
  actions?: LargoAction[];
  sessionId?: string;
  ticker?: string | null;
  /** Strike-specific next questions — competitor-style pills under the answer. */
  followups?: string[];
  nativeFollowups?: boolean;
}) {
  const fallback = <LargoMessageBody content={content} className={className} />;

  const rich = useMemo<ReactNode | null>(() => {
    if (streaming || !content.trim()) return null;

    // Preferred path: a real, populated envelope — render everything it carries.
    if (envelope) {
      // DESK READ when the envelope is rich enough to fill a structured layout, i.e. it carries a
      // verdict AND at least one of levels/sections. Below that bar the card would be a header
      // over an empty grid, which looks broken and says less than the prose it replaced — so the
      // richness test gates the layout rather than the layout inventing filler.
      const richEnough =
        Boolean(envelope.headline || envelope.bias) &&
        ((envelope.levels?.length ?? 0) > 0 ||
          (envelope.sections?.length ?? 0) > 0 ||
          envelope.tradeDecision != null);
      if (richEnough) {
        const { caveats } = splitAnswerCaveats(content);
        return (
          <>
            <LargoStructuredCards
              compareCard={compareCard}
              playSimilarity={playSimilarity}
              preEarningsPack={preEarningsPack}
            />
            <LargoDeskRead envelope={envelope} question={question} markdownSource={content} />
            <LargoActionsBar actions={actions} sessionId={sessionId} />
            <BieScenarioCards scenarios={envelope.scenarios} />
            <LargoAnswerCaveats caveats={caveats} />
            {!streaming && (
              <LargoShareRow
                answer={content}
                headline={envelope.headline ?? null}
                ticker={ticker ?? null}
                bias={envelope.bias ?? null}
                levels={envelope.levels}
                question={question}
              />
            )}
          </>
        );
      }
      return (
        <>
          <BieAnswer
            envelope={{ ...envelope, sections: proseSections(envelope.sections) }}
            bodyClassName={className}
            onFollowup={onFollowup}
          />
          {!streaming && (
            <LargoShareRow
              answer={content}
              headline={envelope.headline ?? null}
              ticker={ticker ?? null}
              bias={envelope.bias ?? null}
              levels={envelope.levels}
              question={question}
            />
          )}
        </>
      );
    }

    // Transition path: wrap the markdown string. Only show bias/confidence when the
    // text states them, and only show an assembly time when we actually have one.
    try {
      const { body, caveats } = splitAnswerCaveats(content);
      const built = largoAnswerToEnvelope(body, {
        source: source ?? null,
        asOf: createdAt ?? undefined,
      });
      return (
        <>
          <LargoStructuredCards
            compareCard={compareCard}
            playSimilarity={playSimilarity}
            preEarningsPack={preEarningsPack}
          />
          <BieAnswer
            envelope={built.envelope}
            showBias={built.showBias}
            showConfidence={built.showConfidence}
            showAsOf={Boolean(createdAt)}
            bodyClassName={className}
            onFollowup={onFollowup}
          />
          <LargoAnswerCaveats caveats={caveats} />
          {!streaming && (
            <LargoShareRow
              answer={content}
              headline={built.envelope.headline ?? null}
              ticker={ticker ?? null}
              bias={built.envelope.bias ?? null}
              levels={built.envelope.levels}
              question={question}
            />
          )}
        </>
      );
    } catch {
      return null;
    }
  }, [content, source, createdAt, envelope, streaming, className, onFollowup, question, compareCard, playSimilarity, preEarningsPack, actions, sessionId, ticker]);


  const shareRow = wantsLargoShareRow(streaming, content, question) ? (
    <LargoShareRow
      answer={content}
      headline={envelope?.headline ?? null}
      ticker={ticker ?? null}
      bias={envelope?.bias ?? null}
      levels={envelope?.levels}
      question={question}
    />
  ) : null;

  if (!rich) {
    return (
      <>
        {fallback}
        {shareRow}
        {!streaming && followups && followups.length > 0 && onFollowup && (
          <LargoFollowupChips followups={followups} onPick={onFollowup} native={nativeFollowups} />
        )}
      </>
    );
  }

  return (
    <>
      <BieAnswerBoundary fallback={<>{fallback}{shareRow}</>}>{rich}</BieAnswerBoundary>
      {!streaming && followups && followups.length > 0 && onFollowup && (
        <LargoFollowupChips followups={followups} onPick={onFollowup} native={nativeFollowups} />
      )}
    </>
  );
}

/** Error boundary: any render failure inside <BieAnswer> degrades to raw markdown. */
class BieAnswerBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
