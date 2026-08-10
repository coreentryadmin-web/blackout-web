"use client";

import { Component, useMemo, type ReactNode } from "react";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import { CreateVisualAction } from "@/features/largo/visual/CreateVisualAction";
import { LargoMessageBody } from "@/features/largo/components/LargoMessageBody";
import { BieAnswer } from "@/features/largo/answer/BieAnswer";
import { LargoDeskRead } from "@/features/largo/answer/LargoDeskRead";
import { largoAnswerToEnvelope } from "@/features/largo/answer/answer-format";

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
}: {
  content: string;
  source?: string | null;
  createdAt?: string | null;
  /** A real envelope from the query API once #59 ships; preferred when present. */
  envelope?: BieAnswerEnvelope | null;
  streaming?: boolean;
  className?: string;
  onFollowup?: (q: string) => void;
  /** The question this answer replies to. Used ONLY to pick which block leads in the desk read —
   *  see answer-layout.ts. Optional everywhere: without it the card renders the default order. */
  question?: string | null;
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
        ((envelope.levels?.length ?? 0) > 0 || (envelope.sections?.length ?? 0) > 0);
      if (richEnough) {
        return (
          <>
            <LargoDeskRead envelope={envelope} question={question} />
            {/* The full prose stays BELOW the card, not replaced by it. The desk read is the
                glanceable summary; the reasoning is what a member checks when the summary says
                something they did not expect, and removing it would make the answer less
                inspectable than before this shipped. */}
            <details className="largo-read-more">
              <summary>Full reasoning</summary>
              <BieAnswer envelope={envelope} bodyClassName={className} onFollowup={onFollowup} />
            </details>
          </>
        );
      }
      return (
        <BieAnswer envelope={envelope} bodyClassName={className} onFollowup={onFollowup} />
      );
    }

    // Transition path: wrap the markdown string. Only show bias/confidence when the
    // text states them, and only show an assembly time when we actually have one.
    try {
      const built = largoAnswerToEnvelope(content, {
        source: source ?? null,
        asOf: createdAt ?? undefined,
      });
      return (
        <BieAnswer
          envelope={built.envelope}
          showBias={built.showBias}
          showConfidence={built.showConfidence}
          showAsOf={Boolean(createdAt)}
          bodyClassName={className}
          onFollowup={onFollowup}
        />
      );
    } catch {
      return null;
    }
  }, [content, source, createdAt, envelope, streaming, className, onFollowup, question]);

  /**
   * CREATE VISUAL — offered only on a REAL, structured answer.
   *
   * Gated on `envelope`, not on `rich`: the visual is rendered from the envelope's structured
   * evidence (levels, gexShifts, headline, bias), so an answer that fell back to raw markdown has
   * nothing a card could honestly be built from. Offering the action there would produce a button
   * whose only outcome is "no visual for this answer".
   *
   * `capturedResults` is deliberately NOT passed: raw tool output never crosses to the browser.
   * The envelope's structured fields were themselves lifted off those same tool results, so the
   * card stays on one snapshot without shipping the whole payload client-side.
   */
  const visual = envelope ? (
    <div className="largo-visual-slot">
      <CreateVisualAction
        question={question ?? ""}
        headline={envelope.headline ?? null}
        // BieBias is bullish/bearish/neutral/mixed; the card's vocabulary is bull/bear/neutral.
        // `mixed` maps to neutral rather than picking a side — the same rule market-state.ts
        // applies when an answer names both directions.
        bias={envelope.bias === "bullish" ? "bull" : envelope.bias === "bearish" ? "bear" : "neutral"}
        envelopeLevels={envelope.levels?.map((l) => ({ label: l.label, value: l.price })) ?? null}
        envelopeGexShifts={envelope.gexShifts ?? null}
        turnId={envelope.turnId ?? null}
      />
    </div>
  ) : null;

  if (!rich) return fallback;

  return (
    <>
      <BieAnswerBoundary fallback={fallback}>{rich}</BieAnswerBoundary>
      {visual}
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
