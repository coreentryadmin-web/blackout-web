import type { FlowAlert } from "@/lib/api";
import { fmtFullTimestamp, timeAgo } from "@/features/helix/lib/helix-flow-format";

/**
 * How a print's time is presented — ONE statement, read by both tape surfaces.
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────────────────────────
 *
 * `HelixMobileFlowTape` rendered **no time at all**. Not an unmarked timestamp — no timestamp. The
 * card shows ticker, side, signals, premium, strike, expiry, DTE and score, and nothing about when
 * the print happened. The cards are sorted newest-first, so ORDER implies recency, but a member
 * cannot tell whether the top card is thirty seconds or thirty-five hours old — and the tape's
 * default window is 168h of history. Off-hours that is the normal case, not an edge one.
 *
 * The desk-wide freshness badge ("35h ago") reports the FEED's age, not each print's, so it does not
 * answer this.
 *
 * ── THE HALF THAT ALSO AFFECTS DESKTOP ──────────────────────────────────────────────────────────
 *
 * Desktop DOES render the time, and marks an estimated one with `helix-tape-time--estimated`
 * (`text-sky-300/50 italic`) plus `title="Ingest time — UW print time unknown"`.
 *
 * A dimmed italic is not a legend: a member who does not already know the convention sees a
 * slightly faded timestamp and can only learn what it means by HOVERING — and **hover does not
 * exist on touch**. So the distinction was conveyed by a channel a phone cannot use, on a tape
 * where MEASURED 2026-08-23 roughly 70% of prints carry an estimated time (§4A: the SPX/SPY index
 * feed sends none). The mark is therefore made VISIBLE — a `~` prefix — rather than relying on
 * styling plus a tooltip.
 *
 * Both surfaces read this, so the two cannot drift into presenting the same field differently —
 * the failure this lane has now fixed six times.
 */

export type TapeTimeDisplay = {
  /** What to render. `~` prefixed when the time is an ingest estimate rather than a print time. */
  label: string;
  /** Hover text. Carries the exact ET timestamp, and says outright when the time is estimated. */
  title: string;
  /** True when this is an ingest time. Callers add `helix-tape-time--estimated` on it. */
  estimated: boolean;
};

/** Marker for an estimated time. A visible character, because a tooltip is unreachable on touch. */
export const ESTIMATED_PREFIX = "~";

/**
 * @param compact `true` renders an age ("35h") for dense card layouts; `false` renders the exact
 *   ET timestamp the desktop column has shown since the tape moved off relative ages. Compact mode
 *   still carries the exact stamp in `title`, so no information is lost — only its position.
 */
export function tapeTimeDisplay(
  flow: Pick<FlowAlert, "alerted_at" | "tape_time_estimated">,
  { compact = false } = {}
): TapeTimeDisplay {
  const iso = flow.alerted_at ?? "";
  const exact = fmtFullTimestamp(iso);
  const estimated = flow.tape_time_estimated === true;

  // No usable time at all. Never rendered as an estimate — "we have no time" and "we have an
  // ingest time" are different facts, and only the second is an estimate of anything.
  if (!iso || exact === "—") {
    return { label: "—", title: "No print time reported", estimated: false };
  }

  const shown = compact ? timeAgo(iso) : exact;
  return {
    label: estimated ? `${ESTIMATED_PREFIX}${shown}` : shown,
    title: estimated
      ? `Ingest time — UW print time unknown (${exact} ET)`
      : `${exact} ET`,
    estimated,
  };
}
