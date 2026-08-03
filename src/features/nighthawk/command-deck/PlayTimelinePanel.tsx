"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import type { TerminalPlay } from "./types";
import { playTimelineInputFromTerminal } from "./play-timeline-input";
import {
  buildPlayTimeline,
  timelineFootnote,
  type PlayTimelineEvent,
} from "@/lib/zerodte/play-timeline";
import { PlayLifecycleStrip } from "./TerminalPremiumPanels";

const REPLAY_STEP_MS = 900;

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
  const [replaying, setReplaying] = useState(false);
  const [replayIndex, setReplayIndex] = useState(-1);

  const stopReplay = useCallback(() => {
    setReplaying(false);
    setReplayIndex(-1);
  }, []);

  const startReplay = useCallback(() => {
    if (events.length === 0) return;
    setReplaying(true);
    setReplayIndex(0);
  }, [events.length]);

  useEffect(() => {
    if (!replaying || events.length === 0) return;
    if (replayIndex >= events.length - 1) {
      const done = window.setTimeout(() => stopReplay(), REPLAY_STEP_MS * 2);
      return () => window.clearTimeout(done);
    }
    const id = window.setTimeout(() => {
      setReplayIndex((i) => i + 1);
    }, REPLAY_STEP_MS);
    return () => window.clearTimeout(id);
  }, [replaying, replayIndex, events.length, stopReplay]);

  if (events.length === 0) {
    return (
      <div className="nh-deck-timeline-empty">
        No lifecycle events on this row yet — timeline fills in once the play flags.
      </div>
    );
  }

  const visibleCount = replaying ? replayIndex + 1 : events.length;

  return (
    <div className="nh-deck-timeline" aria-label="Play timeline replay">
      <PlayLifecycleStrip play={play} />
      <div className="nh-deck-timeline-controls">
        <button
          type="button"
          className={clsx("nh-deck-timeline-replay", replaying && "is-active")}
          onClick={replaying ? stopReplay : startReplay}
          aria-pressed={replaying}
        >
          {replaying ? "■ Stop" : "▶ Replay"}
        </button>
        {replaying && (
          <span className="nh-deck-timeline-progress">
            {visibleCount}/{events.length}
          </span>
        )}
      </div>
      <div className={clsx("nh-deck-timeline-rail", replaying && "is-replaying")}>
        {events.slice(0, visibleCount).map((event, i) => (
          <div
            key={`${event.kind}-${event.order}-${i}`}
            className={clsx(
              "nh-deck-timeline-node",
              replaying && i === replayIndex && "is-live",
            )}
          >
            <div className="nh-deck-timeline-time">
              {event.atEt ?? "—"}
            </div>
            <div className="nh-deck-timeline-track" aria-hidden>
              <span className="nh-deck-timeline-dot" />
              {i < visibleCount - 1 && <span className="nh-deck-timeline-line" />}
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
