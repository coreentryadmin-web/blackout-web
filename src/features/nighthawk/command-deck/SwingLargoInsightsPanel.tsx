"use client";

import Link from "next/link";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { etClock } from "@/lib/et-clock";
import type { TerminalPlay } from "./types";
import { playContractHeadline } from "./play-card-lifecycle";
import { useSwingPlayBrief } from "@/hooks/useSwingPlayBrief";
import { BieAnswer } from "@/features/largo/answer/BieAnswer";
import { renderEnvelopeMarkdown } from "@/lib/bie/answer-envelope";

function largoTerminalHref(play: TerminalPlay, q?: string): string {
  const params = new URLSearchParams({
    desk: "nighthawk",
    ticker: play.ticker,
  });
  if (play.contract) params.set("contract", play.contract);
  if (play.status) params.set("status", play.status);
  if (q) params.set("q", q);
  return `/terminal?${params.toString()}`;
}

/** Center-rail Largo play intelligence — deterministic Ask Largo brief per selected play. */
export function SwingLargoInsightsPanel({ play }: { play: TerminalPlay | null }) {
  const router = useRouter();
  const { envelope, asOf, loading, error, refresh, changeCount } = useSwingPlayBrief(play);

  const onFollowup = useCallback(
    (q: string) => {
      if (!play) return;
      router.push(largoTerminalHref(play, q));
    },
    [play, router],
  );

  if (!play) {
    return (
      <aside className="nh-deck-largo nh-deck-largo-empty" aria-label="Largo play insights">
        <div className="nh-deck-largo__placeholder">
          <span className="nh-deck-largo__kicker">Ask Largo</span>
          <p>Select a play for a live intelligence brief — entry gates, thesis health, cross-market context.</p>
        </div>
      </aside>
    );
  }

  const headline = playContractHeadline(play);
  const largoHref = largoTerminalHref(play);

  return (
    <aside className="nh-deck-largo nh-deck-largo--brief" aria-label={`Ask Largo — ${headline}`}>
      <header className="nh-deck-largo__head">
        <div>
          <span className="nh-deck-largo__kicker">Ask Largo · live intelligence</span>
          <h2 className="nh-deck-largo__title">{headline}</h2>
          {changeCount > 0 ? (
            <span className="nh-deck-largo__delta" aria-live="polite">
              {changeCount} update{changeCount === 1 ? "" : "s"} since last read
            </span>
          ) : null}
        </div>
        <div className="nh-deck-largo__actions">
          <button type="button" className="nh-deck-largo__refresh" onClick={() => refresh()} aria-label="Refresh brief">
            ↻
          </button>
          <Link href={largoHref} className="nh-deck-largo__open">
            Open ↗
          </Link>
        </div>
      </header>

      <div className="nh-deck-largo__brief-body">
        {loading && !envelope ? (
          <div className="nh-deck-largo__loading" aria-live="polite">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="nh-deck-largo__skel" />
            ))}
          </div>
        ) : error && !envelope ? (
          <p className="nh-deck-largo__error" role="alert">Brief unavailable — retrying.</p>
        ) : envelope ? (
          <BieAnswer
            envelope={envelope}
            className="nh-deck-largo__bie"
            bodyClassName="nh-deck-largo__bie-body"
            showAsOf={Boolean(asOf)}
            onFollowup={onFollowup}
          />
        ) : (
          <p className="nh-deck-largo__error">No brief for this play.</p>
        )}
      </div>

      {envelope && (
        <footer className="nh-deck-largo__foot">
          <span className="nh-deck-largo__engine">Deterministic · no LLM</span>
          {asOf ? <span className="nh-deck-largo__asof">Updated {etClock(asOf) ?? "—"} ET</span> : null}
        </footer>
      )}
    </aside>
  );
}

/** Markdown export for accessibility / copy — optional consumer hook. */
export function swingPlayBriefMarkdown(play: TerminalPlay | null, envelope: ReturnType<typeof useSwingPlayBrief>["envelope"]) {
  if (!play || !envelope) return "";
  return renderEnvelopeMarkdown(envelope);
}
