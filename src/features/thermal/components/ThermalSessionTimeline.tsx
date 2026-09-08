"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui";
import {
  fmtSessionEventAge,
  sessionEventGlyph,
  sortSessionEventsNewestFirst,
  type ThermalSessionEvent,
  eventStrike,
} from "@/features/thermal/lib/thermal-session-events";

export function ThermalSessionTimeline({
  events,
  onLevelClick,
  className,
}: {
  events: ThermalSessionEvent[];
  /** Scroll matrix to strike when an event row with a level is clicked. */
  onLevelClick?: (strike: number) => void;
  className?: string;
}) {
  const sorted = useMemo(() => sortSessionEventsNewestFirst(events), [events]);
  const [expanded, setExpanded] = useState(() => sorted.length > 0 && sorted.length <= 3);
  const nowMs = Date.now();

  if (sorted.length === 0) {
    return (
      <div
        className={clsx(
          "rounded-xl border border-white/8 bg-[rgba(8,9,14,0.35)] px-3 py-2",
          className
        )}
        data-thermal-session-timeline="empty"
      >
        <p className="font-mono text-[10px] leading-snug text-sky-300/70">
          Session story fills in as snapshots accumulate — flip crosses, wall breaks, and regime shifts
          appear here after the open.
        </p>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "rounded-xl border border-white/10 bg-[rgba(8,9,14,0.5)]",
        className
      )}
      data-thermal-session-timeline
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left outline-none transition-colors hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400/60"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-sky-300/80">
            Session story
          </span>
          <Badge tone="accent" size="sm">{sorted.length}</Badge>
        </span>
        <span className="shrink-0 font-mono text-[10px] text-sky-300/60" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded ? (
        <ul className="space-y-1 border-t border-white/8 px-2 py-2" role="list">
          {sorted.map((e, i) => {
            const warn = e.severity === "warn";
            const strike = eventStrike(e);
            const clickable = strike != null && onLevelClick != null;
            const rel = fmtSessionEventAge(e.at, nowMs);
            const row = (
              <>
                <span
                  aria-hidden
                  className="mt-px shrink-0 text-[12px] leading-none"
                  style={{ color: warn ? "#ff2d55" : "#7dd3fc" }}
                >
                  {sessionEventGlyph(e.type, e.direction)}
                </span>
                <span
                  className="min-w-0 flex-1 text-[12px] leading-snug"
                  style={{ color: warn ? "#ffd6de" : "#dff1ff" }}
                >
                  {e.message}
                </span>
                {rel ? (
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-sky-300/70">
                    {rel}
                  </span>
                ) : null}
              </>
            );
            if (!clickable) {
              return (
                <li
                  key={`${e.type}-${e.at}-${i}`}
                  className={clsx(
                    "flex items-start gap-2.5 rounded-lg border px-3 py-1.5",
                    warn
                      ? "border-bear/35 bg-bear/[0.06]"
                      : "border-sky-400/25 bg-sky-400/[0.05]"
                  )}
                >
                  {row}
                </li>
              );
            }
            return (
              <li key={`${e.type}-${e.at}-${i}`}>
                <button
                  type="button"
                  title={`Scroll matrix to ${strike}`}
                  className={clsx(
                    "flex w-full items-start gap-2.5 rounded-lg border px-3 py-1.5 text-left outline-none transition-colors",
                    "hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-sky-400/60",
                    warn
                      ? "border-bear/35 bg-bear/[0.06]"
                      : "border-sky-400/25 bg-sky-400/[0.05]"
                  )}
                  onClick={() => onLevelClick!(strike!)}
                >
                  {row}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="border-t border-white/8 px-3 py-2 font-mono text-[10px] leading-snug text-sky-300/75">
          {sorted[0]?.message}
          {sorted.length > 1 ? ` · +${sorted.length - 1} more` : ""}
        </p>
      )}
    </div>
  );
}
