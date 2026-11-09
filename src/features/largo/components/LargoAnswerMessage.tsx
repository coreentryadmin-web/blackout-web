"use client";

import { Component, useMemo, type ReactNode } from "react";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { LargoCompareCard as LargoCompareCardPayload } from "@/lib/largo/compare-card-types";
import type { PlaySimilarityCard } from "@/lib/largo/play-similarity";
import type { PreEarningsPackCard } from "@/lib/largo/pre-earnings-pack";
import type { LargoAction } from "@/lib/largo/largo-actions";
import type { LargoDepth } from "@/lib/largo/largo-depth-mode";
import { LargoMessageBody } from "@/features/largo/components/LargoMessageBody";
import { LargoStructuredCards } from "@/features/largo/components/LargoStructuredCards";
import { LargoActionsBar } from "@/features/largo/components/LargoActionsBar";
import { LargoFollowupChips } from "@/features/largo/components/LargoFollowupChips";
import { BieAnswer } from "@/features/largo/answer/BieAnswer";
import { LargoDeskRead } from "@/features/largo/answer/LargoDeskRead";
import { LargoConcreteAnswer } from "@/features/largo/answer/LargoConcreteAnswer";
import { LargoAnswerCaveats } from "@/features/largo/answer/LargoAnswerCaveats";
import { splitAnswerCaveats } from "@/features/largo/answer/answer-caveats";
import { largoAnswerToEnvelope } from "@/features/largo/answer/answer-format";
import { proseSections } from "@/features/largo/answer/section-policy";
import { BieScenarioCards } from "@/features/largo/answer/BieScenarioCards";
import { BieStructureLadder } from "@/features/largo/answer/BieStructureLadder";

/**
 * Renders a Largo assistant turn. Concrete mode = Talon-style prose; Deep dive = structured cards.
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
  answerMode = "concrete",
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
  followups?: string[];
  nativeFollowups?: boolean;
  /** Concrete = tight Talon read; Deep dive = full structured breakdown. */
  answerMode?: LargoDepth;
}) {
  const fallback = <LargoMessageBody content={content} className={className} />;
  const isConcrete = answerMode === "concrete";

  const rich = useMemo<ReactNode | null>(() => {
    if (streaming || !content.trim()) return null;

    if (isConcrete) {
      return (
        <>
          <LargoStructuredCards
            compareCard={compareCard}
            playSimilarity={playSimilarity}
            preEarningsPack={preEarningsPack}
          />
          <LargoConcreteAnswer content={content} envelope={envelope} className={className} />
          {/* BUG FIX (Ask Largo standing mandate, 2026-11-09): `actions` (desk deep-links —
              "Open Thermal at <flip>", "Add <ticker> to watchlist" — built server-side by
              `buildLargoActions()` in `largo-terminal.ts` for EVERY answer, regardless of
              `answerMode`/depth) was previously rendered only inside the "Deep dive" +
              `richEnough` branch below via `<LargoActionsBar>`. "Concrete" is the product's
              documented DEFAULT `answerMode` (see `LargoConcreteAnswer.tsx`'s own header
              comment and `largo-depth-mode.ts`'s `normalizeLargoDepth`), so for the
              overwhelming majority of real answers these desk actions were computed on every
              turn and then silently dropped before ever reaching the member — the exact same
              "computed-but-render-path-gated" shape as the `tradeDecision`/`structureLadder`
              fixes already landed in this file and its siblings. */}
          <LargoActionsBar actions={actions} sessionId={sessionId} />
        </>
      );
    }

    if (envelope) {
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
            {/* BUG FIX (Ask Largo standing mandate, 2026-11-09): `envelope.structureLadder` — the
                swing play-brief Structure Ladder (real per-level R:R, cross-desk gamma-regime
                agreement, archetype/sub-lane track record) — reached this envelope but this
                "Deep dive" (answerMode="deep") rendering branch never rendered it. `LargoDeskRead`
                immediately above renders a DIFFERENT, generic ladder built from `envelope.levels`
                (`ladderFromLevels`, level-ladder.ts) with no R:R/track-record/agreement data, and
                is not a substitute. `BieAnswer.tsx` — the renderer this component falls back to
                for a NOT-rich-enough envelope and for the no-envelope markdown-shim path below —
                already renders `<BieStructureLadder ladder={envelope.structureLadder} />`, so the
                member only ever saw this widget by NOT switching to Deep dive mode, or by asking a
                question whose envelope happened to miss the `richEnough` bar. See
                `BieStructureLadder`'s own header for what the widget shows. */}
            <BieStructureLadder ladder={envelope.structureLadder} />
            <BieScenarioCards scenarios={envelope.scenarios} />
            <LargoAnswerCaveats caveats={caveats} />
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
          <LargoActionsBar actions={actions} sessionId={sessionId} />
        </>
      );
    }

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
          <LargoActionsBar actions={actions} sessionId={sessionId} />
          <LargoAnswerCaveats caveats={caveats} />
        </>
      );
    } catch {
      return null;
    }
  }, [
    content,
    source,
    createdAt,
    envelope,
    streaming,
    className,
    onFollowup,
    question,
    compareCard,
    playSimilarity,
    preEarningsPack,
    actions,
    sessionId,
    isConcrete,
  ]);

  const followupRow =
    !streaming && followups && followups.length > 0 && onFollowup ? (
      <LargoFollowupChips followups={followups} onPick={onFollowup} native={nativeFollowups} />
    ) : null;

  if (!rich) {
    return (
      <>
        <div className="largo-answer-with-panel">
          <div className="largo-answer-main">{fallback}</div>
        </div>
        {followupRow}
      </>
    );
  }

  return (
    <>
      <div className="largo-answer-with-panel">
        <div className="largo-answer-main">
          <BieAnswerBoundary fallback={fallback}>{rich}</BieAnswerBoundary>
        </div>
      </div>
      {followupRow}
    </>
  );
}

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
