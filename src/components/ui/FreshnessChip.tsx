"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";

export type FreshnessStatus = "live" | "stale" | "cached" | "offline" | "syncing";

export type FreshnessChipProps = {
  status: FreshnessStatus;
  /** When the underlying data was last successfully fetched or generated. */
  asOf?: Date | null;
  /** Optional override for the status word (e.g. "Cached snapshot"). */
  label?: string;
  /**
   * Optional plain-English explanation of what this layer IS, shown on hover ahead of the
   * "Last updated" stamp. A chip has room for two or three words, which is enough to name a
   * layer but never enough to explain one — without this the reader is left to guess.
   */
  title?: string;
  className?: string;
  /**
   * When `status` is `"live"` and `asOf` is set, flip the chip to `"stale"` after
   * this many ms past `asOf`. Lets parents drop their own 1Hz `setNow` timers —
   * only this leaf re-renders every second (Vector / Thermal latency fix).
   */
  staleAfterMs?: number;
};

const STATUS_LABEL: Record<FreshnessStatus, string> = {
  live: "Live",
  stale: "Stale",
  cached: "Cached",
  offline: "Offline",
  syncing: "Syncing",
};

const STATUS_TONE: Record<FreshnessStatus, string> = {
  live: "border-bull/35 bg-bull/10 text-bull",
  stale: "border-gold/35 bg-gold/10 text-gold",
  cached: "border-gold/35 bg-gold/10 text-gold",
  offline: "border-bear/35 bg-bear/10 text-bear-text",
  syncing: "border-sky-400/30 bg-sky-400/10 text-sky-300",
};

const DOT_TONE: Record<FreshnessStatus, string> = {
  live: "bg-bull",
  stale: "bg-gold",
  cached: "bg-gold",
  offline: "bg-bear-text",
  syncing: "bg-sky-400 animate-pulse motion-reduce:animate-none",
};

function formatAge(from: Date, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - from.getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

/**
 * Honest data-freshness indicator — status word + optional age since `asOf`.
 * Replaces misleading always-green "Live" badges on marketing/desk surfaces.
 */
export function FreshnessChip({
  status,
  asOf,
  label,
  title,
  className,
  staleAfterMs,
}: FreshnessChipProps) {
  // SSR-safe: `now` stays null on the server and the first client render, so the markup is
  // byte-identical across hydration. The relative age (Date.now()-derived) and the locale-formatted
  // title only appear after mount. This avoids React #418: the chip renders on every live value, so
  // a Date.now()/toLocaleString() server-vs-client mismatch here forced a full-page client re-render
  // (and content flash) on every load.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    // Tick while we show age OR while we may need to flip live→stale.
    const needsTick =
      (status !== "syncing" && asOf != null) ||
      (status === "live" && staleAfterMs != null && asOf != null);
    if (!needsTick) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status, asOf, staleAfterMs]);

  const effectiveStatus: FreshnessStatus =
    status === "live" &&
    staleAfterMs != null &&
    now != null &&
    asOf != null &&
    now - asOf.getTime() > staleAfterMs
      ? "stale"
      : status;

  const word = label ?? STATUS_LABEL[effectiveStatus];
  const age =
    now != null && asOf && effectiveStatus !== "syncing" && effectiveStatus !== "offline"
      ? formatAge(asOf, now)
      : null;

  return (
    <span
      data-freshness={effectiveStatus}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] tabular-nums",
        STATUS_TONE[effectiveStatus],
        className
      )}
      title={
        [title, now != null && asOf ? `Last updated ${asOf.toLocaleString()}` : null]
          .filter(Boolean)
          .join(" · ") || undefined
      }
    >
      <span
        aria-hidden
        className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", DOT_TONE[effectiveStatus])}
      />
      <span>
        {word}
        {age != null ? ` · ${age}` : null}
      </span>
    </span>
  );
}
