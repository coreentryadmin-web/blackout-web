import type { BieUnavailableSource } from "@/lib/bie/answer-envelope";
import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import type { SwingPlayBriefContext } from "./play-brief-types";

/** HELIX recent_flow is only trustworthy when the feed is fresh — stale pipeline rows are absence, not signal. */
export function trustedHelixFlow(eco: EcosystemContext | null | undefined) {
  if (!eco?.recent_flow || eco.flow_feed_fresh === false) return null;
  return eco.recent_flow;
}

/** Aggregate every honest absence signal for the swing play brief envelope (Largo C3). */
export function collectBriefUnavailableSources(ctx: SwingPlayBriefContext): BieUnavailableSource[] {
  const out: BieUnavailableSource[] = [...(ctx.ecosystem?.arsenal?.unavailable_sources ?? [])];

  if (ctx.ecosystem?.flow_feed_fresh === false) {
    out.push({ source: "HELIX flow", reason: "pipeline stale" });
  }
  // FINDINGS 2026-09-06 (#22): dataHonestyCoaching() already narrates "mark not synced to live
  // tape" from this exact boolean, but that prose never reached the structured C3 channel — a
  // consumer reading unavailableSources alone (rather than scraping the narrative) saw nothing
  // wrong. Same class of gap this file already closed for HELIX flow staleness.
  if (ctx.play?.markIsSync === true) {
    out.push({ source: "option mark", reason: "sync quote without freshness timestamp" });
  }
  if (ctx.openBook === null) {
    out.push({ source: "open book", reason: "ledger read failed" });
  }
  if (ctx.meridian?.unavailable) {
    out.push({ source: "Meridian catalysts", reason: "timeline read failed" });
  }

  return out;
}
