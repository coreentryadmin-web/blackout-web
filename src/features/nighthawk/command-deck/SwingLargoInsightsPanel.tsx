"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { etClock } from "@/lib/et-clock";
import type { TerminalPlay } from "./types";
import { playContractHeadline } from "./play-card-lifecycle";
import { useSwingPlayBrief } from "@/hooks/useSwingPlayBrief";
import { BieAnswer } from "@/features/largo/answer/BieAnswer";
import { renderEnvelopeMarkdown } from "@/lib/bie/answer-envelope";
import { managementActionDisplay } from "./terminal-display";

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

function isWorkingPlay(play: TerminalPlay): boolean {
  return play.status === "OPEN" || play.status === "HOLD" || play.status === "TRIM";
}

function SwingBriefActionStrip({ play }: { play: TerminalPlay }) {
  const recommendation = play.recommendation ?? "HOLD";
  const action = useMemo(
    () => managementActionDisplay(play, recommendation, play.progress ?? null),
    [play, recommendation],
  );

  if (!isWorkingPlay(play)) return null;

  const tone =
    action.verb === "SELL"
      ? "sell"
      : action.verb === "TRIM"
        ? "trim"
        : action.verb === "BUY"
          ? "buy"
          : "hold";

  return (
    <div className={clsx("nh-deck-largo__action-strip", `nh-deck-largo__action-strip--${tone}`)} aria-label="Desk action">
      <div className="nh-deck-largo__action-strip-primary">
        <span className="nh-deck-largo__action-verb">{action.verb}</span>
        {action.sizePct != null ? <span className="nh-deck-largo__action-size">{action.sizePct}%</span> : null}
        <span className="nh-deck-largo__action-urgency">{action.urgency}</span>
      </div>
      <p className="nh-deck-largo__action-reason">{action.reason}</p>
      {play.exitPolicy?.trim_levels?.length ? (
        <div className="nh-deck-largo__action-trims">
          {play.exitPolicy.trim_levels.map((t) => (
            <span
              key={t.trigger_pct}
              className={clsx("nh-deck-largo__action-trim", t.fired && "is-fired")}
            >
              +{t.trigger_pct}%{t.fired ? " ✓" : ""}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Center-rail Largo play intelligence — deterministic Ask Largo brief per selected play. */
export function SwingLargoInsightsPanel({ play }: { play: TerminalPlay | null }) {
  const router = useRouter();
  const [expandIntel, setExpandIntel] = useState(false);
  const { envelope, asOf, loading, error, refresh, changeCount, isLiveRefreshing } = useSwingPlayBrief(play, {
    expandIntel,
  });

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
  const hasNarrative = useMemo(
    () => envelope?.sections?.some((s) => s.title === "Trade manager read") ?? false,
    [envelope],
  );

  return (
    <aside className="nh-deck-largo nh-deck-largo--brief" aria-label={`Ask Largo — ${headline}`}>
      <header className="nh-deck-largo__head">
        <div>
          <span className="nh-deck-largo__kicker">
            Ask Largo · live intelligence
            {isLiveRefreshing ? <span className="nh-deck-largo__live-dot" aria-label="Refreshing live data" /> : null}
          </span>
          <h2 className="nh-deck-largo__title">{headline}</h2>
          {changeCount > 0 ? (
            <span className="nh-deck-largo__delta" aria-live="polite">
              {changeCount} update{changeCount === 1 ? "" : "s"} since last read
            </span>
          ) : null}
        </div>
        <div className="nh-deck-largo__actions">
          {hasNarrative ? (
            <button
              type="button"
              className={clsx("nh-deck-largo__detail-toggle", expandIntel && "is-on")}
              onClick={() => setExpandIntel((v) => !v)}
              aria-pressed={expandIntel}
            >
              {expandIntel ? "Hide detail" : "Show detail"}
            </button>
          ) : null}
          <button type="button" className="nh-deck-largo__refresh" onClick={() => refresh()} aria-label="Refresh brief">
            ↻
          </button>
          <Link href={largoHref} className="nh-deck-largo__open">
            Open ↗
          </Link>
        </div>
      </header>

      <SwingBriefActionStrip play={play} />

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
