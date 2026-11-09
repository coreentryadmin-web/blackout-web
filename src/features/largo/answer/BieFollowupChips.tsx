"use client";

import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";

/**
 * "Ask next" chip row for `envelope.followups` — the situational, answer-specific follow-up
 * questions a BIE answer builder derives from the exact read it just gave (e.g. swing play-brief's
 * `followupsFor()`: "Should I trim more?" for a TAKE_PARTIAL play, "Why is this at its stop?" for a
 * STOP_OUT one — see `play-brief.ts`'s `SITUATIONAL_FOLLOWUP_BY_MANAGE_ACTION`). Extracted out of
 * `BieAnswer.tsx` (same markup/classNames, behaviour-neutral there) so `LargoAnswerMessage`'s Deep
 * dive branch can render the identical chips instead of silently dropping them — see that file's
 * header comment for why this was missing.
 */
export function BieFollowupChips({
  followups,
  onFollowup,
}: {
  followups: BieAnswerEnvelope["followups"];
  onFollowup?: (q: string) => void;
}) {
  if (!onFollowup || !followups || followups.length === 0) return null;
  return (
    <div className="bie-answer-followups">
      <span className="bie-block-label">Ask next</span>
      <div className="bie-answer-followups-row">
        {followups.slice(0, 4).map((f) => (
          <button key={f} type="button" className="bie-followup-chip" onClick={() => onFollowup(f)}>
            {f}
          </button>
        ))}
      </div>
    </div>
  );
}
