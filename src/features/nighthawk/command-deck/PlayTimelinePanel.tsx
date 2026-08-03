"use client";

import { useMemo } from "react";
import { clsx } from "clsx";
import type { TerminalPlay } from "./types";
import { playTimelineInputFromTerminal } from "./play-timeline-input";
import {
  buildPlayTimeline,
  timelineFootnote,
  type PlayTimelineEvent,
} from "@/lib/zerodte/play-timeline";

function eventTone(event: PlayTimelineEvent): string {
  if (event.kind === "stop") return "stop";
  if (event.kind === "milestone" || event.kind === "now") {
    return (event.pnlPct ?? 0) >= 0 ? "up" : "dn";
  }
  if (event.kind === "trim") return "trim";
  if (event.kind === "close") return "sched";
  return "neutral";
}

export function PlayTimelinePanel({
  play,
  nowMs,
}: {
  play: TerminalPlay;
  nowMs: number;
}) {
  const events = useMemo(() => {
    const input = playTimelineInputFromTerminal(play, nowMs);
    return buildPlayTimeline(input);
  }, [play, nowMs]);

  const footnote = timelineFootnote(events);

  if (events.length === 0) {
    return (
      <div className="nh-deck-timeline-empty">
        No lifecycle events on this row yet — timeline fills in once the play flags.
      </div>
    );
  }

  return (
    <div className="nh-deck-timeline" aria-label="Play timeline replay">
      <div className="nh-deck-timeline-rail">
        {events.map((event, i) => (
          <div key={`${event.kind}-${event.order}-${i}`} className="nh-deck-timeline-node">
            <div className="nh-deck-timeline-time">
              {event.atEt ?? "—"}
            </div>
            <div className="nh-deck-timeline-track" aria-hidden>
              <span className="nh-deck-timeline-dot" />
              {i < events.length - 1 && <span className="nh-deck-timeline-line" />}
            </div>
            <div className={clsx("nh-deck-timeline-body", eventTone(event))}>
              <div className="nh-deck-timeline-label">{event.label}</div>
              {event.detail && (
                <div className="nh-deck-timeline-detail">{event.detail}</div>
              )}
            </div>
          </div>
        ))}
      </div>
      {footnote && <div className="nh-deck-timeline-note">{footnote}</div>}
    </div>
  );
}
