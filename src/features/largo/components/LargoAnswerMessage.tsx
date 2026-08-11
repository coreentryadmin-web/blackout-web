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
  autoVisual,
  turnId,
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
  /**
   * The server's auto-render directive, present only when the member ASKED for an image.
   *
   * Threaded straight through rather than re-derived here: the SERVER read the intent off the
   * question (`detectVisualIntent`), and a second client-side reading is a second place for the
   * two to disagree about whether a card was requested.
   */
  autoVisual?: { size: "x_landscape" | "x_portrait" | "square" | "story" } | null;
  /**
   * The persisted turn behind this answer. Enough on its own to offer a card: the server rebuilds
   * from that turn's stored tool results, which is strictly MORE evidence than the envelope's
   * levels and gexShifts, not less.
   */
  turnId?: number | null;
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
   * CREATE VISUAL — offered when there is anything honest to draw from.
   *
   * THE GATE USED TO BE `envelope` ALONE, and that was a stale reading of where the card's
   * evidence comes from. It was true when the card was drawn from the envelope's own levels and
   * gexShifts; since the composer landed, the server rebuilds from the TURN's stored tool
   * results — a strictly richer source that the envelope was never the gatekeeper of.
   *
   * The cost of the stale gate was measured live: `envelopeFromContract` returns null whenever the
   * model's reply drifts off the section contract, and on those turns the slot was not rendered at
   * all. So a member could ask for an image in as many words, the server could correctly detect the
   * request and set the auto-render directive, and the component that acts on it was never mounted.
   * The two questions in the live probe that failed this way — tomorrow's NH plays, today's 0DTE
   * results — are squarely the ones a member asks when they want something to post.
   *
   * `turnId || envelope`, not `turnId && envelope`: either is sufficient. With a turn the server
   * replays real evidence; with only an envelope the old envelope-fields path still works, which
   * is what rehydrated history turns (no turn id in the transcript) fall back to.
   *
   * `capturedResults` is deliberately NOT passed: raw tool output never crosses to the browser.
   */
  const visual = envelope || turnId != null ? (
    <div className="largo-visual-slot">
      <CreateVisualAction
        question={question ?? ""}
        headline={envelope?.headline ?? null}
        // BieBias is bullish/bearish/neutral/mixed; the card's vocabulary is bull/bear/neutral.
        // `mixed` maps to neutral rather than picking a side — the same rule market-state.ts
        // applies when an answer names both directions.
        bias={envelope?.bias === "bullish" ? "bull" : envelope?.bias === "bearish" ? "bear" : "neutral"}
        envelopeLevels={envelope?.levels?.map((l) => ({ label: l.label, value: l.price })) ?? null}
        envelopeGexShifts={envelope?.gexShifts ?? null}
        // Top-level id first; `envelope.turnId` is the pre-#2037 shape, kept so a client holding a
        // rehydrated message from before this shipped still resolves a turn.
        turnId={turnId ?? envelope?.turnId ?? null}
        autoRender={autoVisual ?? null}
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
