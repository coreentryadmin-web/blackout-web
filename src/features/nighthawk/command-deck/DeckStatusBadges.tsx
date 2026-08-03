"use client";

import { clsx } from "clsx";
import type { StatusTone } from "./play-card-lifecycle";

/** Color-coded lifecycle status — ACTIVE / WATCH / CLOSED / FAILED. */
export function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span className={clsx("nh-deck-status-pill", `is-${tone}`)} role="status">
      <span className="nh-deck-status-pill__dot" aria-hidden />
      {label}
    </span>
  );
}

/** Age decay badge — compact time since trigger with green → amber → orange → red urgency. */
export function AgeDecayBadge({
  compactAge,
  decayTone,
  pulse = false,
}: {
  compactAge: string;
  decayTone: "fresh" | "aging" | "stale" | "late" | "closed";
  pulse?: boolean;
}) {
  return (
    <span className={clsx("nh-deck-age-decay", `is-${decayTone}`, pulse && "is-pulse")}>
      <span className="nh-deck-age-decay__dot" aria-hidden />
      {compactAge}
    </span>
  );
}
