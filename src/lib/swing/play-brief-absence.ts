import type { BieUnavailableSource } from "@/lib/bie/answer-envelope";
import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import type { SwingPlayBriefContext } from "./play-brief-types";

/** HELIX recent_flow is only trustworthy when the feed is fresh — stale pipeline rows are absence, not signal. */
export function trustedHelixFlow(eco: EcosystemContext | null | undefined) {
  if (!eco?.recent_flow || eco.flow_feed_fresh === false) return null;
  return eco.recent_flow;
}

function hasVectorDeskState(ctx: SwingPlayBriefContext): boolean {
  const vec = ctx.vector ?? ctx.ecosystem?.vector_full_state ?? null;
  return vec != null && Number.isFinite(vec.spot);
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
  // Cold GEX is distinct from a total ecosystem fetch failure — the read succeeded but the shared
  // matrix had no positioning for this ticker.
  if (!ctx.ecosystemFetchFailed && ctx.ecosystem && !ctx.ecosystem.gex_positioning) {
    out.push({ source: "GEX positioning", reason: "cold matrix / no positioning read" });
  }
  // Missing Vector desk state is distinct from vectorFetchFailed — ecosystem read succeeded but
  // neither ctx.vector nor ecosystem.vector_full_state carried a live spot.
  if (!ctx.vectorFetchFailed && ctx.ecosystem && !hasVectorDeskState(ctx)) {
    out.push({ source: "Vector desk state", reason: "snapshot unavailable" });
  }
  if (ctx.openBook === null) {
    out.push({ source: "open book", reason: "ledger read failed" });
  }
  if (ctx.meridian?.unavailable) {
    out.push({ source: "Meridian catalysts", reason: "timeline read failed" });
  }
  // FINDINGS 2026-09-06 (#11): `ecosystem`/`vector` being null is otherwise ambiguous between a
  // legitimately empty read and a total fetch failure — the arsenal-level unavailable_sources
  // above only covers a failure WITHIN a successful ecosystem read, not the whole call throwing.
  if (ctx.ecosystemFetchFailed === true) {
    out.push({ source: "ecosystem context", reason: "fetch failed" });
  }
  // Standalone Vector fetch can fail while ecosystem.vector_full_state still succeeded in parallel.
  if (ctx.vectorFetchFailed === true && !ctx.vector && !ctx.ecosystem?.vector_full_state) {
    out.push({ source: "Vector state", reason: "fetch failed" });
  }
  if (ctx.meridianPeer?.available === false) {
    const peer = ctx.meridianPeer;
    const reason = peer.error ?? peer.note ?? "unavailable";
    out.push({ source: "Meridian peer cohort", reason });
  }

  return out;
}
