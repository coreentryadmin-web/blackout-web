import type { BieUnavailableSource } from "@/lib/bie/answer-envelope";
import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import type { VectorAbsenceReport, VectorSection } from "@/lib/bie/vector-absent-sections";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { VectorFreshnessBlock } from "@/lib/bie/vector-state-freshness";
import type { GexPositioning } from "@/lib/providers/gex-positioning";
import type { SwingPlayBriefContext } from "./play-brief-types";
import { thesisHealthUncalibrated } from "./thesis-health";

type VectorWithReadContext = VectorFullState & Partial<VectorAbsenceReport & VectorFreshnessBlock>;

const VECTOR_SECTION_LABELS: Record<VectorSection, string> = {
  gex_walls: "Vector GEX walls",
  gamma_flip: "Vector gamma flip",
  max_pain: "Vector max pain",
  expected_move: "Vector expected move",
  ladder: "Vector GEX ladder",
  heatmap: "Vector heatmap",
  technicals: "Vector technicals",
  flow_markers: "Vector flow prints",
  vex_walls: "Vector VEX walls",
  dark_pool_levels: "Vector dark pool",
  wall_history: "Vector wall history",
  play: "Vector play",
};

const VECTOR_STALE_MS = 120_000;
/** Shared with Vector — dealer posture must not read "Right now" past this age. */
export const GEX_MATRIX_STALE_MS = VECTOR_STALE_MS;

/** Age of the shared GEX matrix in ms — prefers matrix_age_sec, else asof vs read time. */
export function gexMatrixAgeMs(
  gex: GexPositioning | null | undefined,
  readMs: number = Date.now(),
): number | null {
  if (!gex) return null;
  if (typeof gex.matrix_age_sec === "number" && Number.isFinite(gex.matrix_age_sec)) {
    return gex.matrix_age_sec * 1000;
  }
  if (gex.asof) {
    const observedMs = Date.parse(gex.asof);
    if (Number.isFinite(observedMs)) return readMs - observedMs;
  }
  return null;
}

export function gexMatrixStale(
  gex: GexPositioning | null | undefined,
  readMs: number = Date.now(),
): boolean {
  const ageMs = gexMatrixAgeMs(gex, readMs);
  return ageMs != null && ageMs > GEX_MATRIX_STALE_MS;
}

/** Only committed working rows expect a live-synced option mark — WATCH uses static chain mid by design. */
export function playExpectsLiveOptionMark(status: string | null | undefined): boolean {
  return status === "OPEN" || status === "HOLD" || status === "TRIM";
}

/** HELIX recent_flow is only trustworthy when the feed is fresh — stale pipeline rows are absence, not signal. */
export function trustedHelixFlow(eco: EcosystemContext | null | undefined) {
  if (!eco?.recent_flow || eco.flow_feed_fresh === false) return null;
  return eco.recent_flow;
}

function vectorOf(ctx: SwingPlayBriefContext): VectorWithReadContext | null {
  return ctx.vector ?? ctx.ecosystem?.vector_full_state ?? null;
}

function hasVectorDeskState(ctx: SwingPlayBriefContext): boolean {
  const vec = vectorOf(ctx);
  return vec != null && Number.isFinite(vec.spot);
}

function collectVectorSectionAbsences(vec: VectorWithReadContext): BieUnavailableSource[] {
  const sections = vec.unavailable_sections ?? [];
  if (!sections.length) return [];

  const out: BieUnavailableSource[] = [];
  for (const section of sections) {
    if (section === "wall_history" && vec.wall_history_empty_reason === "outside_rth_no_recording_yet") {
      continue;
    }
    out.push({
      source: VECTOR_SECTION_LABELS[section],
      reason: "not present on this read",
    });
  }
  return out;
}

function collectVectorStalenessAbsence(vec: VectorWithReadContext): BieUnavailableSource | null {
  const ageMs = vec.dataAgeMs;
  const staleByAge = typeof ageMs === "number" && Number.isFinite(ageMs) && ageMs > VECTOR_STALE_MS;
  if (staleByAge || vec.freshness === "stale") {
    return { source: "Vector snapshot", reason: "stale — levels may lag spot" };
  }
  return null;
}

function collectGexStalenessAbsence(
  gex: GexPositioning | null | undefined,
  readMs: number,
): BieUnavailableSource | null {
  if (!gexMatrixStale(gex, readMs)) return null;
  return { source: "GEX matrix", reason: "stale — dealer posture may lag spot" };
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
  // WATCH rows carry a static chain mid (no markAsOf) by design — not a missing source.
  if (
    ctx.play?.markIsSync === true &&
    playExpectsLiveOptionMark(ctx.play?.status)
  ) {
    out.push({ source: "option mark", reason: "sync quote without freshness timestamp" });
  }
  // Cold GEX is distinct from a total ecosystem fetch failure — the read succeeded but the shared
  // matrix had no positioning for this ticker.
  if (!ctx.ecosystemFetchFailed && ctx.ecosystem && !ctx.ecosystem.gex_positioning) {
    out.push({ source: "GEX positioning", reason: "cold matrix / no positioning read" });
  }
  const gex = ctx.ecosystem?.gex_positioning;
  const gexStale = collectGexStalenessAbsence(gex, Date.now());
  if (gexStale) out.push(gexStale);
  // Missing Vector desk state is distinct from vectorFetchFailed — ecosystem read succeeded but
  // neither ctx.vector nor ecosystem.vector_full_state carried a live spot.
  if (!ctx.vectorFetchFailed && ctx.ecosystem && !hasVectorDeskState(ctx)) {
    out.push({ source: "Vector desk state", reason: "snapshot unavailable" });
  }
  const vec = vectorOf(ctx);
  if (vec && hasVectorDeskState(ctx)) {
    out.push(...collectVectorSectionAbsences(vec));
    const stale = collectVectorStalenessAbsence(vec);
    if (stale) out.push(stale);
    // reportVectorAbsences treats non-null flowMarkers as present even when available=false.
    if (vec.flowMarkers?.available === false) {
      out.push({
        source: "Vector flow prints",
        reason: vec.flowMarkers.reason ?? "unavailable",
      });
    }
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
  } else if (ctx.meridianPeer?.available === true && ctx.meridianPeer.insufficient_reason?.trim()) {
    out.push({
      source: "Meridian peer cohort",
      reason: ctx.meridianPeer.insufficient_reason.trim(),
    });
  }
  // Prior-session discovery scan: WATCH rows can still carry yesterday's lane snapshot while the
  // brief stamps today's sessionDate — without this, scanAsOf prose looks current (C3 gap).
  if (
    ctx.scanSessionDay &&
    ctx.sessionDate &&
    ctx.scanSessionDay !== ctx.sessionDate
  ) {
    out.push({
      source: "swing discovery scan",
      reason: `prior session (${ctx.scanSessionDay}) — today's scan not yet run`,
    });
  }
  // Committed positions compute thesis health without setup/entry/signal inputs — the aggregate
  // % collapses to a generic default. Surface that honestly (Largo C3/C6) rather than showing 46%.
  if (
    ctx.play &&
    ["OPEN", "HOLD", "TRIM"].includes(String(ctx.play.status ?? "").toUpperCase()) &&
    thesisHealthUncalibrated(ctx.play.thesisHealth)
  ) {
    out.push({
      source: "thesis health",
      reason: "setup/entry/signal inputs unavailable for committed positions",
    });
  }

  return out;
}
