"use client";

import { clsx } from "clsx";

/** Competitor-style follow-up pills — stacked under each answer, strike-specific. */
export function LargoFollowupChips({
  followups,
  onPick,
  className,
  native = false,
}: {
  followups: string[];
  onPick: (question: string) => void;
  className?: string;
  native?: boolean;
}) {
  if (!followups.length) return null;

  return (
    <div className={clsx("largo-followup-chips", native && "largo-followup-chips-native", className)}>
      {followups.map((q) => (
        <button
          key={q}
          type="button"
          className="largo-followup-chip"
          onClick={() => onPick(q)}
        >
          {q}
        </button>
      ))}
    </div>
  );
}
