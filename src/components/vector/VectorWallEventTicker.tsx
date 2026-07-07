"use client";

import clsx from "clsx";
import type { VectorWallEvent } from "@/lib/providers/vector-wall-events";
import type { VectorWallLens } from "@/lib/providers/vector-wall-history";
import { formatReplayClock } from "@/lib/vector-replay";

type Props = {
  events: VectorWallEvent[];
  lens: VectorWallLens;
};

/** Deterministic wall-structure event feed — no LLM, grounded in ladder diffs + spot crosses. */
export function VectorWallEventTicker({ events, lens }: Props) {
  const visible = events.filter((e) => e.lens === lens).slice(-5).reverse();

  return (
    <div
      className="mb-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
      aria-label="Wall structure events"
    >
      <div className="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-400">
        Structure feed
      </div>
      {visible.length === 0 ? (
        <p className="font-mono text-[11px] text-sky-300">
          No {lens.toUpperCase()} structure shifts yet this session — events appear when walls or flip migrate, or SPX crosses a level.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {visible.map((event, i) => (
            <li
              key={`${event.time}-${event.kind}-${i}`}
              className={clsx(
                "font-mono text-[11px] leading-snug",
                event.severity === "warn" ? "text-rose-300" : "text-white"
              )}
            >
              <span className="text-sky-300">{formatReplayClock(event.time)}</span>
              <span className="text-white/40"> · </span>
              {event.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
